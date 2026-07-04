import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact, ExchangeEntry, Playbook } from "./types.ts";
import type { LlmAdapter } from "./llm.ts";
import { runElicit, runInduce, runConfirm, toArtifact, type SessionIO, type SessionLang } from "./engine.ts";

export const ARTIFACTS_DIR = process.env.CC_ARTIFACTS_DIR ?? "artifacts";

interface SessionState {
  exchange: ExchangeEntry[];
  stage_index: number;
  elicit_done?: boolean;
}

export type SessionOutcome = "authorized" | "aborted" | "blocked";

function loadUpstream(pb: Playbook, io: SessionIO): Record<string, unknown> {
  const upstream: Record<string, unknown> = {};
  for (const dep of pb.consumes) {
    const depPath = join(ARTIFACTS_DIR, `${dep}.json`);
    if (existsSync(depPath)) {
      upstream[dep] = (JSON.parse(readFileSync(depPath, "utf8")) as Artifact).content;
    } else {
      io.note(`(note: upstream artifact "${dep}" not found — continuing without it)`);
    }
  }
  return upstream;
}

function saveArtifact(pb: Playbook, content: Record<string, unknown>, exchange: ExchangeEntry[]): void {
  writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.json`), JSON.stringify(toArtifact(pb, content), null, 2));
  if (exchange.length > 0) {
    writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.transcript.json`), JSON.stringify(exchange, null, 2));
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
  opts: { lang?: SessionLang } = {},
): Promise<SessionOutcome> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const artPath = join(ARTIFACTS_DIR, `${pb.id}.json`);
  if (!existsSync(artPath)) {
    io.say("There is no authorized artifact for this step yet.");
    return "blocked";
  }
  const upstream = loadUpstream(pb, io);

  const transcriptPath = join(ARTIFACTS_DIR, `${pb.id}.transcript.json`);
  const exchange: ExchangeEntry[] = existsSync(transcriptPath)
    ? (JSON.parse(readFileSync(transcriptPath, "utf8")) as ExchangeEntry[])
    : [];

  const content = (JSON.parse(readFileSync(artPath, "utf8")) as Artifact).content;
  // Candidate-style nodes store only the chosen wording — surface it as the draft.
  const field = pb.confirm?.choice_field;
  const draft: Record<string, unknown> =
    pb.confirm?.present === "candidates" && field && typeof content[field] === "string"
      ? { ...content, candidates: [content[field]] }
      : { ...content };

  const authorized = await runConfirm(
    pb, draft, io,
    (feedback) => runInduce(pb, llm, exchange, upstream, io, feedback, opts.lang),
    { existingFirst: true },
  );

  saveArtifact(pb, authorized, exchange);
  io.say(`Artifact authorized and saved to ${ARTIFACTS_DIR}/${pb.id}.json`);
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
  opts: { header?: boolean; lang?: SessionLang; autoResume?: boolean } = {},
): Promise<SessionOutcome> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const sessionPath = join(ARTIFACTS_DIR, `${pb.id}.session.json`);

  const io: SessionIO = {
    ...baseIO,
    onTurn: (exchange, stageIndex) => {
      writeFileSync(
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

  const upstream = loadUpstream(pb, io);

  let exchange: ExchangeEntry[] = [];

  if (pb.elicit) {
    let resume: SessionState | undefined;
    if (existsSync(sessionPath)) {
      const saved = JSON.parse(readFileSync(sessionPath, "utf8")) as SessionState;
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
      writeFileSync(
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

  const draft = await runInduce(pb, llm, exchange, upstream, io, undefined, opts.lang);
  const authorized = await runConfirm(pb, draft, io, (feedback) =>
    runInduce(pb, llm, exchange, upstream, io, feedback, opts.lang),
  );

  saveArtifact(pb, authorized, exchange);
  if (existsSync(sessionPath)) unlinkSync(sessionPath);

  io.say(`Artifact authorized and saved to ${ARTIFACTS_DIR}/${pb.id}.json`);
  if (pb.invalidates.length > 0) {
    io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
  }
  return "authorized";
}
