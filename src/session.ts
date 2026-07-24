import type { Artifact, ExchangeEntry, Playbook } from "./types.ts";
import type { LlmAdapter } from "./llm.ts";
import type { Storage } from "./storage.ts";
import { runElicit, runInduce, runConfirm, skipContent, toArtifact, type SessionIO, type SessionLang } from "./engine.ts";

interface SessionState {
  exchange: ExchangeEntry[];
  stage_index: number;
  elicit_done?: boolean;
}

export type SessionOutcome = "authorized" | "aborted" | "blocked";

export async function loadUpstream(pb: Playbook, io: SessionIO, store: Storage): Promise<Record<string, unknown>> {
  const upstream: Record<string, unknown> = {};
  for (const dep of pb.consumes) {
    const raw = await store.read(`${dep}.json`);
    if (raw !== null) {
      upstream[dep] = (JSON.parse(raw) as Artifact).content;
    } else {
      io.note(`(note: upstream artifact "${dep}" not found — continuing without it)`);
    }
  }
  return upstream;
}

export async function saveArtifact(
  pb: Playbook,
  content: Record<string, unknown>,
  exchange: ExchangeEntry[],
  store: Storage,
  origin: Artifact["origin"] = "generated",
): Promise<void> {
  await store.write(`${pb.id}.json`, JSON.stringify(toArtifact(pb, content, origin), null, 2));
  if (exchange.length > 0) {
    await store.write(`${pb.id}.transcript.json`, JSON.stringify(exchange, null, 2));
  }
}

/**
 * Edit mode for an already-authorized node: present the saved artifact in the
 * review step immediately (no model call), then let the user amend it turn by
 * turn, reprocess it from sources, or re-authorize as is.
 */
export async function runReviewSession(
  pb: Playbook,
  llm: LlmAdapter,
  io: SessionIO,
  opts: { store: Storage; lang?: SessionLang },
): Promise<SessionOutcome> {
  const store = opts.store;
  const artRaw = await store.read(`${pb.id}.json`);
  if (artRaw === null) {
    io.say("There is no authorized artifact for this step yet.");
    return "blocked";
  }
  const upstream = await loadUpstream(pb, io, store);

  const transcriptRaw = await store.read(`${pb.id}.transcript.json`);
  const exchange: ExchangeEntry[] = transcriptRaw !== null ? (JSON.parse(transcriptRaw) as ExchangeEntry[]) : [];

  const content = (JSON.parse(artRaw) as Artifact).content;
  // Candidate-style nodes store only the chosen wording — surface it as the draft.
  const field = pb.confirm?.choice_field;
  const draft: Record<string, unknown> =
    pb.confirm?.present === "candidates" && field && typeof content[field] === "string"
      ? { ...content, candidates: [content[field]] }
      : { ...content };

  const authorized = await runConfirm(
    pb, draft, io,
    (feedback, prior) => runInduce(pb, llm, exchange, upstream, io, feedback, opts.lang, prior),
    { existingFirst: true, llm, lang: opts.lang, exchange },
  );

  await saveArtifact(pb, authorized, exchange, store);
  io.say(`Artifact authorized and saved (${pb.id}).`);
  if (pb.invalidates.length > 0) {
    io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
  }
  return "authorized";
}

/** Full node lifecycle: resume offer → elicit → induce → confirm → save. UI-agnostic. */
export async function runPlaybookSession(
  pb: Playbook,
  llm: LlmAdapter,
  baseIO: SessionIO,
  opts: { store: Storage; header?: boolean; lang?: SessionLang; autoResume?: boolean },
): Promise<SessionOutcome> {
  const store = opts.store;
  const sessionPath = `${pb.id}.session.json`;

  const io: SessionIO = {
    ...baseIO,
    onTurn: (exchange, stageIndex) => {
      void store.write(
        sessionPath,
        JSON.stringify({ exchange, stage_index: stageIndex } satisfies SessionState, null, 2),
      );
      baseIO.onTurn?.(exchange, stageIndex);
    },
  };

  if (opts.header !== false) {
    io.say(`━━━ ${pb.title} ━━━`);
    io.say(`What happens in this step (shown in full, always):\n${pb.purpose.trim()}`);
  }

  const upstream = await loadUpstream(pb, io, store);

  let exchange: ExchangeEntry[] = [];
  let interviewSkipped = false;

  if (pb.elicit) {
    let resume: SessionState | undefined;
    const savedRaw = await store.read(sessionPath);
    if (savedRaw !== null) {
      const saved = JSON.parse(savedRaw) as SessionState;
      if (saved.exchange.length > 0) {
        if (opts.autoResume) {
          resume = saved;
        } else {
          const answer = (
            await io.ask(`a saved conversation (${saved.exchange.length} entries) exists — (r)esume it or (s)tart over`)
          ).trim().toLowerCase();
          if (answer.startsWith("r")) resume = saved;
        }
      }
    }

    if (resume?.elicit_done) {
      exchange = resume.exchange;
      io.note("(the interview was already complete — moving straight to drafting)");
    } else {
      const elicited = await runElicit(
        pb, llm, io,
        resume ? { exchange: resume.exchange, stageIndex: resume.stage_index } : undefined,
        opts.lang,
        upstream,
      );
      if (elicited.aborted) {
        io.note("(no artifact yet — your progress is saved; open this step again to resume)");
        return "aborted";
      }
      exchange = elicited.exchange;
      interviewSkipped = elicited.skipped === true;
      await store.write(
        sessionPath,
        JSON.stringify(
          { exchange, stage_index: pb.elicit.stages.length, elicit_done: true } satisfies SessionState,
          null, 2,
        ),
      );
      io.note("(the conversation is complete — solidifying it into a draft…)");
    }
  } else {
    const present = pb.consumes.filter((d) => d in upstream);
    if (present.length === 0 && pb.consumes.length > 0) {
      io.say(`This derived step needs upstream artifacts (${pb.consumes.join(", ")}) and none exist yet. Author those first.`);
      return "blocked";
    }
    io.note("(derived step — no interview; drafting from your authorized artifacts)");
  }

  // A skipped interview closes gracefully: no induction over an empty
  // transcript (its schemas demand material that doesn't exist) — a
  // schema-shaped empty artifact is offered for authorization, and the
  // button says what it does: skip this step. The elicit run signals it
  // (checker-verified: no stage done, no satisfied evidence); the fallback
  // covers resumed sessions that were saved before this signal existed.
  const skipped = interviewSkipped || (pb.elicit &&
    !exchange.some((e) => e.speaker === "user" && e.text.trim() && !e.text.trim().startsWith("/")));
  if (skipped) {
    io.note(opts.lang?.code === "ru"
      ? "(шаг закрывается пустым — подтверди, чтобы продолжить путь)"
      : "(this step closes empty — confirm to keep going)");
    const empty = skipContent(pb);
    const authorized = await runConfirm(pb, empty, io, async () => empty, {
      lang: opts.lang, exchange, skipMode: true,
    });
    await saveArtifact(pb, authorized, exchange, store, "skipped");
    await store.remove(sessionPath);
    io.say(`Step skipped and closed (${pb.id}).`);
    return "authorized";
  }

  const draft = await runInduce(pb, llm, exchange, upstream, io, undefined, opts.lang);
  const authorized = await runConfirm(
    pb, draft, io,
    (feedback, prior) => runInduce(pb, llm, exchange, upstream, io, feedback, opts.lang, prior),
    { llm, lang: opts.lang, exchange },
  );

  await saveArtifact(pb, authorized, exchange, store);
  await store.remove(sessionPath);

  io.say(`Artifact authorized and saved (${pb.id}).`);
  if (pb.invalidates.length > 0) {
    io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
  }
  return "authorized";
}
