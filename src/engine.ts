import type {
  Artifact, ChatTurn, ExchangeEntry, InduceStep, Playbook, Stage,
} from "./types.ts";
import type { LlmAdapter } from "./llm.ts";
import { gatherMarked, verbatimViolations } from "./verbatim.ts";
import { cfg } from "./config.ts";

// Output ceiling for an induce step. Generous by default; env-tunable because
// high reasoning effort spends this budget on thinking before the JSON.
const INDUCE_MAX_TOKENS = Number(cfg("LLM_INDUCE_MAX_TOKENS") ?? 8192);

export interface ReviewPayload {
  mode: "candidates" | "structured_review";
  draft: Record<string, unknown>;
  candidates: string[];
  choice_field?: string;
  authorize_language: string;
  verified_quotes: string[];
  warnings: string[];
  /** True when showing an already-authorized artifact (edit mode), until it is revised. */
  existing?: boolean;
}

export type ReviewAction =
  | { action: "authorize"; value?: string }
  | { action: "feedback"; text: string }
  | { action: "reprocess" };

export interface SessionIO {
  say(text: string): void;
  note(text: string): void;
  ask(prompt: string): Promise<string>;
  /** Called after every exchange so the caller can persist progress incrementally. */
  onTurn?(exchange: ExchangeEntry[], stageIndex: number): void;
  /** Structured confirm step. When absent, confirm falls back to ask()-based chat prompts. */
  review?(payload: ReviewPayload): Promise<ReviewAction>;
  /** A deterministic anchor-question message (baked, not model-generated). Falls back to say(). */
  sayAnchor?(text: string): void;
}

export interface SessionLang {
  code: string;
  instruction: string;
}

const GREETINGS: Record<string, string> = {
  en: "Hi — I'm glad you're here.",
  ru: "Привет! Хорошо, что ты здесь.",
};

export function stageOpening(stage: Stage, lang?: SessionLang): string {
  const localized = lang ? stage.opening_i18n?.[lang.code] : undefined;
  return (localized ?? stage.opening).trim();
}

export interface ResumeState {
  exchange: ExchangeEntry[];
  stageIndex: number;
}

export const CHECKER_SYSTEM =
  "You audit an interview transcript against a checklist. Judge only from what the user actually said, and default to unsatisfied when evidence is missing or ambiguous. " +
  "For every checklist item, list the entities it ranges over (the named models, stories, favorites — whatever the item counts or quantifies with 'each' or 'every'), judge each entity separately with a supporting quote from the transcript (truncate quotes to at most eight words), and set required_count to the minimum number of satisfied entities the item demands (null when the item names no count and no 'each'). " +
  "An 'each X' item demands every X the checklist expects, not every X mentioned so far — 'each of the three models' means three. " +
  "A statement the user explicitly applies to several entities at once ('all of them', 'I am like them…') is evidence for each of those entities; a statement about one entity is evidence for that entity alone. " +
  "Never mark an item satisfied on the strength of one single-entity example when it quantifies over several. Return JSON only.";

export function interviewerSystem(
  pb: Playbook,
  stage: Stage,
  lang?: SessionLang,
  upstream?: Record<string, unknown>,
): string {
  const probes = (stage.probes ?? [])
    .map((p) => `- When ${p.when}: ${p.then}`)
    .join("\n");
  return [
    `You are the interviewer for the "${pb.title}" step of a career construction session.`,
    pb.elicit!.persona.trim(),
    "Hard rules you must never break:",
    ...pb.elicit!.guardrails.map((g) => `- ${g}`),
    `Current topic goal: ${stage.goal}`,
    `Anchor question for this topic (use this wording, adapted only lightly to the flow): ${stageOpening(stage, lang)}`,
    probes ? `Probe guidance:\n${probes}` : "",
    "Ask exactly one question per message and keep each message to a few sentences.",
    "Messages wrapped in [brackets] are stage directions from the application, not the user. Never mention them.",
    lang
      ? `Conduct the entire conversation in ${lang.instruction}. Translate the anchor question faithfully — keep its meaning intact.`
      : "",
    pb.elicit!.share_upstream && upstream && Object.keys(upstream).length > 0
      ? `The user's authorized artifacts, for reference (when instructed to quote from these, quote exactly, word for word):\n${JSON.stringify(upstream, null, 2)}`
      : "",
  ].filter(Boolean).join("\n\n");
}

interface CheckerItem {
  index: number;
  satisfied: boolean;
  required_count: number | null;
  entities: { name: string; evidence: string; satisfied: boolean }[];
}

/* The small tier pattern-matches "similarities were discussed → satisfied"
 * on items that quantify over entities ("each of the three models"), which
 * once ended a stage after one comparison of three. The schema now forces a
 * per-entity tally with quoted evidence, and the arithmetic lives HERE — the
 * model enumerates, the code counts. */
function checkerItemOk(r: CheckerItem): boolean {
  const ents = r.entities ?? [];
  if (r.required_count != null) return ents.filter((e) => e.satisfied).length >= r.required_count;
  if (ents.length > 0) return r.satisfied && ents.every((e) => e.satisfied);
  return r.satisfied;
}

export async function checkStageDone(
  llm: LlmAdapter,
  stage: Stage,
  exchange: ExchangeEntry[],
): Promise<boolean> {
  const transcript = exchange.map((e) => `${e.speaker}: ${e.text}`).join("\n");
  const checklist = stage.done_when.map((d, i) => `${i}. ${d}`).join("\n");
  const raw = await llm.complete({
    tier: "small",
    system: CHECKER_SYSTEM,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `Transcript:\n${transcript}\n\nChecklist:\n${checklist}\n\nFor each item: which entities does it range over, is each satisfied (with a supporting quote), how many satisfied entities does it require, and is the item satisfied?`,
      },
    ],
    jsonSchema: {
      type: "object",
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            required: ["index", "satisfied", "required_count", "entities"],
            properties: {
              index: { type: "integer" },
              satisfied: { type: "boolean" },
              required_count: { type: ["integer", "null"] },
              entities: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "evidence", "satisfied"],
                  properties: {
                    name: { type: "string" },
                    evidence: { type: "string" },
                    satisfied: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  try {
    const parsed = JSON.parse(raw) as { results: CheckerItem[] };
    // Every checklist item must be covered and pass — a shorter answer fails.
    return stage.done_when.every((_, i) =>
      parsed.results.some((r) => r.index === i && checkerItemOk(r)));
  } catch {
    return false;
  }
}

export interface ElicitResult {
  exchange: ExchangeEntry[];
  userWords: string;
  aborted: boolean;
}

export async function runElicit(
  pb: Playbook,
  llm: LlmAdapter,
  io: SessionIO,
  resume?: ResumeState,
  lang?: SessionLang,
  upstream?: Record<string, unknown>,
): Promise<ElicitResult> {
  const exchange: ExchangeEntry[] = resume ? [...resume.exchange] : [];
  const messages: ChatTurn[] = exchange.map((e) => ({
    role: e.speaker === "user" ? ("user" as const) : ("assistant" as const),
    content: e.text,
  }));
  const stages = pb.elicit!.stages;
  const startIndex = Math.min(resume?.stageIndex ?? 0, stages.length - 1);
  let resuming = resume !== undefined && exchange.length > 0;

  for (let i = startIndex; i < stages.length; i++) {
    const stage = stages[i];
    io.note(`(topic ${i + 1} of ${stages.length}: ${stage.id})`);
    const system = interviewerSystem(pb, stage, lang, upstream);
    let skipGenerate = false;

    if (i === 0 && exchange.length === 0) {
      // The session opener is deterministic: the anchor question is meant to be
      // asked of everyone, verbatim — no model call, no latency, no variation.
      const opener = `${GREETINGS[lang?.code ?? "en"] ?? GREETINGS.en}\n\n${stageOpening(stage, lang)}`;
      messages.push({ role: "assistant", content: opener });
      exchange.push({ speaker: "interviewer", text: opener });
      (io.sayAnchor ?? io.say)(opener);
      skipGenerate = true;
    } else if (resuming && exchange[exchange.length - 1]?.speaker === "interviewer") {
      // The saved conversation ends with an unanswered question — no model call,
      // just wait for the answer to the question the user already saw.
      skipGenerate = true;
      resuming = false;
    } else {
      messages.push({
        role: "user",
        content: resuming
          ? "[The session was interrupted earlier and has just been resumed. Welcome the user back in one short sentence and continue this topic where it left off.]"
          : `[Topic complete. Move on to the next topic and ask its anchor question: ${stageOpening(stage, lang)}]`,
      });
      resuming = false;
    }

    // The stage's first question: the topic-transition or welcome-back turn.
    // Follow-ups within the topic are generated inside the loop, concurrently
    // with the checker.
    if (!skipGenerate) {
      const question = await llm.complete({ tier: "small", system, messages });
      messages.push({ role: "assistant", content: question });
      exchange.push({ speaker: "interviewer", text: question });
      io.say(question);
      // Persist interviewer turns too, so resuming never regenerates a question
      // the user already saw. The baked opener alone is deliberately not
      // persisted — merely opening a node must not mark it in-progress.
      if (exchange.some((e) => e.speaker === "user")) io.onTurn?.(exchange, i);
    }

    // No turn cap: the checklist alone ends a topic. The user can always
    // /skip a topic or leave (progress is saved), so a strict checker can't
    // trap anyone.
    for (;;) {
      const answer = await io.ask("you");
      if (answer.trim() === "/quit") return { exchange, userWords: userWords(exchange), aborted: true };
      if (answer.trim() === "/skip") {
        io.note(`(skipped remaining checks for topic "${stage.id}")`);
        break;
      }
      messages.push({ role: "user", content: answer });
      exchange.push({ speaker: "user", text: answer });
      io.onTurn?.(exchange, i);

      // The follow-up question is generated speculatively while the checker
      // runs — continuing the topic is the common case, so this halves turn
      // latency. When the checker ends the topic instead, the follow-up is
      // discarded unseen and the next stage opens as before.
      const [done, followUp] = await Promise.all([
        checkStageDone(llm, stage, exchange),
        llm.complete({ tier: "small", system, messages }),
      ]);
      if (done) break;
      messages.push({ role: "assistant", content: followUp });
      exchange.push({ speaker: "interviewer", text: followUp });
      io.say(followUp);
      io.onTurn?.(exchange, i);
    }
  }

  return { exchange, userWords: userWords(exchange), aborted: false };
}

function userWords(exchange: ExchangeEntry[]): string {
  return exchange.filter((e) => e.speaker === "user").map((e) => e.text).join("\n");
}

export function induceStepSystem(pb: Playbook, step: InduceStep, lang?: SessionLang): string {
  return [
    `You are the induction engine for the "${pb.title}" step of a career construction session.`,
    `Task: ${step.task.trim()}`,
    "Every string in a field marked x-verbatim in the schema must be an exact quote of the user's own words — from the transcript or from the upstream artifacts. Never paraphrase those.",
    "Optional fields that allow null: emit null rather than inventing content the user never provided.",
    ...(step.validation ?? []).map((v) => `Constraint: ${v}`),
    "Return only JSON matching the schema.",
    lang
      ? `Write all free-text output in ${lang.instruction}. Strings marked x-verbatim must remain exactly as the user said them, in the user's own language.`
      : "",
  ].filter(Boolean).join("\n\n");
}

/** Everything the models are told for this node, compiled exactly as sent. */
export function compiledPrompts(pb: Playbook, lang?: SessionLang): unknown {
  return {
    stages: (pb.elicit?.stages ?? []).map((s) => ({
      id: s.id,
      system: interviewerSystem(pb, s, lang),
      done_when: s.done_when,
    })),
    checker: pb.elicit ? CHECKER_SYSTEM : null,
    induce: (pb.induce?.steps ?? []).map((st) => ({
      id: st.id,
      model_tier: st.model_tier,
      system: induceStepSystem(pb, st, lang),
      output_schema: st.output_schema,
    })),
  };
}

export function stringValuesDeep(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringValuesDeep);
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(stringValuesDeep);
  return [];
}

async function runInduceStep(
  llm: LlmAdapter,
  pb: Playbook,
  step: InduceStep,
  transcript: string,
  upstream: Record<string, unknown>,
  verbatimSource: string,
  feedback: string | undefined,
  lang: SessionLang | undefined,
  prior?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const system = induceStepSystem(pb, step, lang);

  const sourceBlock = transcript
    ? `Transcript:\n${transcript}`
    : "There is no interview transcript for this step — compose strictly from the upstream artifacts below.";
  const upstreamBlock = Object.keys(upstream).length
    ? `\n\nAuthorized upstream artifacts:\n${JSON.stringify(upstream, null, 2)}`
    : "";
  const priorBlock = prior
    ? `\n\nThe current draft, possibly hand-edited by the user (keep their edits unless the feedback says otherwise):\n${JSON.stringify(prior, null, 2)}`
    : "";
  const feedbackBlock = feedback ? `\n\nUser feedback on the previous draft (address it):\n${feedback}` : "";

  const attempt = async (extra: string): Promise<Record<string, unknown>> => {
    const raw = await llm.complete({
      tier: step.model_tier,
      system,
      messages: [
        { role: "user", content: `${sourceBlock}${upstreamBlock}${priorBlock}${feedbackBlock}${extra}` },
      ],
      jsonSchema: step.output_schema,
      maxTokens: INDUCE_MAX_TOKENS,
      temperature: step.temperature,
    });
    return JSON.parse(raw.replace(/^```(json)?\n?|\n?```$/g, "")) as Record<string, unknown>;
  };

  let result = await attempt("");
  let violations = verbatimViolations(result, step.output_schema, verbatimSource);
  if (violations.length > 0) {
    result = await attempt(
      `\n\nYour previous attempt contained strings that are not exact quotes of the user. Fix these by quoting the user's actual words:\n${violations
        .map((v) => `- "${v}"`)
        .join("\n")}`,
    );
    violations = verbatimViolations(result, step.output_schema, verbatimSource);
    if (violations.length > 0) {
      (result as Record<string, unknown>)._verbatim_warnings = violations;
    }
  }
  return result;
}

export async function runInduce(
  pb: Playbook,
  llm: LlmAdapter,
  exchange: ExchangeEntry[],
  upstream: Record<string, unknown>,
  io: SessionIO,
  feedback?: string,
  lang?: SessionLang,
  prior?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const transcript = exchange.map((e) => `${e.speaker === "user" ? "user" : "interviewer"}: ${e.text}`).join("\n");
  const verbatimSource = [
    ...exchange.filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");
  const draft: Record<string, unknown> = {};
  for (const step of pb.induce!.steps) {
    io.note(`(inducing: ${step.id}…)`);
    Object.assign(draft, await runInduceStep(llm, pb, step, transcript, upstream, verbatimSource, feedback, lang, prior));
  }
  return draft;
}

/* ── the amend conversation ─────────────────────────────────────────────
 * A change request is talked through before anything is rewritten: the
 * counselor clarifies, plays the planned change back, and only a clear
 * user confirmation triggers the recompose. */

const MAX_AMEND_TURNS = 8;

const AMEND_TURN_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["reply", "revise", "drop"] },
    say: { type: "string" },
    directive: { type: "string" },
  },
  required: ["action", "say", "directive"],
  additionalProperties: false,
};

export function amendChatSystem(pb: Playbook, lang?: SessionLang): string {
  return [
    `You are the counselor for the "${pb.title}" step of a career construction session. The user is reviewing a drafted artifact and has asked for a change. Your job is to settle WHAT should change through a short conversation — the rewrite itself happens later, by a separate engine.`,
    [
      "Each turn, return JSON with:",
      '- action "reply" — keep talking: `say` is your next message, asking exactly one question. Clarify when the request is ambiguous or could be applied more than one way; once the change is clear, play back in one or two sentences exactly what will change and ask the user to confirm. Leave `directive` empty.',
      '- action "revise" — the user has clearly confirmed (yes / go ahead / exactly). `directive` compiles every agreed change into one compact instruction for the rewrite engine; `say` is a brief acknowledgment, or empty.',
      '- action "drop" — the user withdrew the request or wants the draft kept as it is. `say` acknowledges briefly; the draft stays. Leave `directive` empty.',
    ].join("\n"),
    "The user's first request alone is never a confirmation — always reply at least once before revising. Never rewrite the draft yourself inside `say`, and never put changes into `directive` that the user did not agree to.",
    lang ? `Write \`say\` in ${lang.instruction}.` : "",
  ].filter(Boolean).join("\n\n");
}

/** Returns the agreed change directive, or null when the user drops the
 * request. The dialogue is appended to `exchange` (marked `phase:"amend"`)
 * so the recompose can quote the user's new words and the saved transcript
 * carries the full session log. */
export async function runAmendChat(
  pb: Playbook,
  llm: LlmAdapter,
  draft: Record<string, unknown>,
  firstComment: string,
  io: SessionIO,
  lang: SessionLang | undefined,
  exchange: ExchangeEntry[],
): Promise<string | null> {
  const start = exchange.length;
  exchange.push({ speaker: "user", text: firstComment, phase: "amend" });
  const userAsks = () =>
    exchange.slice(start).filter((e) => e.speaker === "user").map((e) => e.text).join("\n");

  for (let turn = 0; turn < MAX_AMEND_TURNS; turn++) {
    const convo = exchange
      .slice(start)
      .map((e) => `${e.speaker === "user" ? "user" : "counselor"}: ${e.text}`)
      .join("\n");
    let out: { action?: string; say?: string; directive?: string };
    try {
      const raw = await llm.complete({
        tier: "small",
        system: amendChatSystem(pb, lang),
        messages: [{
          role: "user",
          content: `The draft under review:\n${JSON.stringify(draft, null, 2)}\n\nThe amend conversation so far:\n${convo}`,
        }],
        jsonSchema: AMEND_TURN_SCHEMA,
        temperature: 0.4,
      });
      out = JSON.parse(raw.replace(/^```(json)?\n?|\n?```$/g, "")) as typeof out;
    } catch {
      // A failed chat turn must never strand the request — fall back to the
      // old immediate behavior with everything the user has asked so far.
      return userAsks();
    }
    const say = out.say?.trim() || (out.action === "reply" ? "…" : "");
    if (say) {
      io.say(say);
      exchange.push({ speaker: "interviewer", text: say, phase: "amend" });
    }
    if (out.action === "revise") return out.directive?.trim() || userAsks();
    if (out.action === "drop") {
      // Withdrawn: scrub the conversation from the exchange so the abandoned
      // request can never steer a later recompose (the transcript feeds the
      // composer verbatim). The on-screen chat keeps what was said.
      exchange.length = start;
      return null;
    }
    const answer = await io.ask("you");
    exchange.push({ speaker: "user", text: answer, phase: "amend" });
  }
  return userAsks(); // cap reached — revise with everything the user asked
}

function collectVerbatim(pb: Playbook, draft: Record<string, unknown>): { verified_quotes: string[]; warnings: string[] } {
  const warnings = (draft._verbatim_warnings ?? []) as string[];
  const all = (pb.induce?.steps ?? []).flatMap((step) => gatherMarked(draft, step.output_schema));
  const verified = [...new Set(all.filter((q) => !warnings.includes(q)))];
  return { verified_quotes: verified, warnings };
}

export async function runConfirm(
  pb: Playbook,
  draft: Record<string, unknown>,
  io: SessionIO,
  reinduce: (feedback?: string, prior?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  opts: { existingFirst?: boolean; llm?: LlmAdapter; lang?: SessionLang; exchange?: ExchangeEntry[] } = {},
): Promise<Record<string, unknown>> {
  const confirm = pb.confirm!;
  let current = draft;
  let existing = opts.existingFirst ?? false;

  if (io.review) {
    for (;;) {
      const candidates = (current.candidates ?? []) as string[];
      const act = await io.review({
        mode: confirm.present,
        draft: current,
        candidates,
        choice_field: confirm.choice_field,
        authorize_language: confirm.authorize_language.trim(),
        existing,
        ...collectVerbatim(pb, current),
      });
      if (act.action === "feedback" || act.action === "reprocess") {
        let feedback = act.action === "feedback" ? act.text : undefined;
        if (act.action === "feedback" && opts.llm) {
          // Talk the change through first; only a confirmed request revises.
          const settled = await runAmendChat(pb, opts.llm, current, act.text, io, opts.lang, opts.exchange ?? []);
          if (settled === null) continue; // withdrawn — the draft stands
          feedback = settled;
        }
        io.note("(revising…)");
        // A feedback revision hands the current draft over as `prior` so the
        // recomposer keeps everything that was not discussed — the amend
        // conversation promises "only this changes", and a from-scratch
        // recompose is free to drop fields (it silently emptied guides in
        // testing). Reprocess deliberately recomposes from sources alone.
        current = await reinduce(feedback, act.action === "feedback" ? current : undefined);
        existing = false;
        continue;
      }
      if (confirm.present === "candidates") {
        const field = confirm.choice_field ?? "chosen";
        const { candidates: _dropped, ...rest } = current;
        return { ...rest, [field]: act.value ?? candidates[0] ?? "" };
      }
      return current;
    }
  }

  if (confirm.present === "candidates") {
    const candidates = (current.candidates ?? []) as string[];
    io.say("Here are drafts assembled from your own words — pick one, or edit:");
    candidates.forEach((c, i) => io.say(`  ${i + 1}. ${c}`));
    let chosen: string | undefined;
    while (chosen === undefined) {
      const answer = (await io.ask("number to pick, or type your own version")).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= candidates.length) chosen = candidates[n - 1];
      else if (answer.length > 0) chosen = answer;
    }
    const field = confirm.choice_field ?? "chosen";
    const { candidates: _dropped, ...rest } = current;
    current = { ...rest, [field]: chosen };
    io.say(confirm.authorize_language.trim());
    return current;
  }

  // structured_review
  for (;;) {
    io.say("Draft artifact — your words, organized:");
    io.say(JSON.stringify(current, null, 2));
    const answer = (await io.ask("press enter to authorize, or describe what to fix")).trim();
    if (answer === "") {
      io.say(confirm.authorize_language.trim());
      return current;
    }
    io.note("(revising…)");
    current = await reinduce(answer, current);
  }
}

export function toArtifact(
  pb: Playbook,
  content: Record<string, unknown>,
  origin: Artifact["origin"] = "generated",
): Artifact {
  return {
    playbook_id: pb.id,
    playbook_version: pb.version,
    authorized_at: new Date().toISOString(),
    origin,
    content,
  };
}
