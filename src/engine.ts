import type {
  Artifact, ChatTurn, ExchangeEntry, InduceStep, Playbook, Stage,
} from "./types.ts";
import type { LlmAdapter } from "./llm.ts";
import { borrowedAcrossEntities, gatherMarked, verbatimViolations } from "./verbatim.ts";
import { adoptPaths, applyOps, PATCH_SCHEMA, type PatchOp } from "./patch.ts";
import { extractJson } from "./jsonish.ts";
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
  /** Top-level fields in the order the playbook declares them, for the review. */
  field_order?: string[];
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
  en: "Hey — glad you're here.",
  ru: "Привет. Хорошо, что ты здесь.",
};

export function stageOpening(stage: Stage, lang?: SessionLang): string {
  const localized = lang ? stage.opening_i18n?.[lang.code] : undefined;
  return (localized ?? stage.opening).trim();
}

/** The step's user-facing "what happens here" text, in the session language.
 * Never reaches a model prompt — the purpose is shown, not compiled. */
export function playbookPurpose(pb: Playbook, lang?: SessionLang): string {
  const localized = lang ? pb.purpose_i18n?.[lang.code] : undefined;
  return (localized ?? pb.purpose).trim();
}

/** The sentence shown at the moment of authorization, in the session language. */
export function authorizeLanguage(pb: Playbook, lang?: SessionLang): string {
  const confirm = pb.confirm;
  if (!confirm) return "";
  const localized = lang ? confirm.authorize_language_i18n?.[lang.code] : undefined;
  return (localized ?? confirm.authorize_language).trim();
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
  "Never mark an item satisfied on the strength of one single-entity example when it quantifies over several. " +
  "Separately, set skip_requested true ONLY when the user's latest turn addresses the interviewer to ask that this topic be skipped or passed over (in any language), and copy the exact user words that make the request into skip_quote. " +
  "Words like 'skip' inside a story, a memory, or something another person said ('my mama said let's skip it') are shared CONTENT, not a request — skip_requested stays false. When in doubt, false. " +
  "A skip request is never evidence: items stay unsatisfied unless the transcript satisfies them. Return JSON only.";

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
    "Write plain prose. No markdown, no asterisks, no bullets or headings — the client reads your words set as text, so any markup arrives on screen as literal characters. For emphasis, choose the word.",
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
export function checkerItemOk(r: CheckerItem): boolean {
  const ents = r.entities ?? [];
  if (r.required_count != null) return ents.filter((e) => e.satisfied).length >= r.required_count;
  if (ents.length > 0) return r.satisfied && ents.every((e) => e.satisfied);
  return r.satisfied;
}

export interface StageCheck {
  done: boolean;
  /** The user asked (in any wording/language) to skip this topic. */
  skip: boolean;
  /** The transcript satisfied at least one item or entity — real material exists. */
  evidence: boolean;
}

export async function checkStageDone(
  llm: LlmAdapter,
  stage: Stage,
  exchange: ExchangeEntry[],
): Promise<StageCheck> {
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
      required: ["results", "skip_requested", "skip_quote"],
      properties: {
        skip_requested: { type: "boolean" },
        skip_quote: { type: "string" },
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
    const parsed = extractJson(raw) as { results: CheckerItem[]; skip_requested?: boolean; skip_quote?: string };
    // Every checklist item must be covered and pass — a shorter answer fails.
    const done = stage.done_when.every((_, i) =>
      parsed.results.some((r) => r.index === i && checkerItemOk(r)));
    const evidence = parsed.results.some((r) =>
      r.satisfied || (r.entities ?? []).some((e) => e.satisfied));
    // Quote-gate against skip false-positives: the model must cite the words
    // that make the request, they must come from the LATEST user turn, and
    // they must BE that turn (not a fragment quoted inside a memory — "my
    // mama said 'let's skip it'" is content, not a request).
    let skip = false;
    if (parsed.skip_requested === true && !done) {
      const lastUser = [...exchange].reverse().find((e) => e.speaker === "user")?.text.trim() ?? "";
      const quote = (parsed.skip_quote ?? "").trim();
      skip = quote.length > 0
        && lastUser.toLowerCase().includes(quote.toLowerCase())
        && quote.length >= lastUser.length * 0.6;
    }
    return { done, skip, evidence };
  } catch {
    return { done: false, skip: false, evidence: false };
  }
}

export interface ElicitResult {
  exchange: ExchangeEntry[];
  userWords: string;
  aborted: boolean;
  /** The user skipped with nothing shared — the step closes gracefully. */
  skipped?: boolean;
  /** Testing backdoor (/simulateAuthorize): close the node immediately with a
   * schema-shaped empty object, no review. Never advertised in the UI. */
  simulated?: boolean;
}

/** Schema-shaped empty content for a step the user chose to skip: every
 * required field present, every field honest about holding nothing. */
export function skipContent(pb: Playbook): Record<string, unknown> {
  const schema = pb.artifact?.schema as
    | { required?: string[]; properties?: Record<string, { type?: string }> }
    | undefined;
  const out: Record<string, unknown> = {};
  for (const key of schema?.required ?? []) {
    const t = schema?.properties?.[key]?.type;
    out[key] = t === "array" ? [] : t === "object" ? {} : t === "string" ? "" : null;
  }
  return out;
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
  // Graceful-skip bookkeeping: a session where no stage ever completed and
  // the checker never saw a satisfied item holds no material — it closes as
  // skipped rather than running induction over nothing.
  let anyDone = false;
  let materialSeen = false;
  const messages: ChatTurn[] = exchange.map((e) => ({
    role: e.speaker === "user" ? ("user" as const) : ("assistant" as const),
    content: e.text,
  }));
  const stages = pb.elicit!.stages;
  const startIndex = Math.min(resume?.stageIndex ?? 0, stages.length - 1);
  let resuming = resume !== undefined && exchange.length > 0;

  for (let i = startIndex; i < stages.length; i++) {
    const stage = stages[i];
    // The stage id is an internal handle — it belongs in the transparency
    // panel, not in the user's chat.
    io.note(`(topic ${i + 1} of ${stages.length})`);
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
    } else if (resuming && exchange[exchange.length - 1]?.speaker === "user") {
      // The session died between an answer and its verdict. Judge the answer
      // FIRST: welcoming the user back into a topic they already finished is
      // how the counselor and the counter drifted apart — the model spoke the
      // transition itself while the checker kept grading the old checklist,
      // and the step read as stuck. If the verdict says done, the next stage
      // opens through its own transition turn, counter and checklist agreed.
      resuming = false;
      const verdict = await checkStageDone(llm, stage, exchange);
      materialSeen ||= verdict.evidence;
      if (verdict.done || verdict.skip) {
        anyDone ||= verdict.done;
        continue;
      }
      messages.push({
        role: "user",
        content: "[The session was interrupted earlier and has just been resumed. Welcome the user back in one short sentence and continue this topic where it left off.]",
      });
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

    // A terminal stage hands something back — the motto, the send-off — and is
    // done the moment it is said. Waiting here would make the user answer a
    // goodbye to be allowed to leave, and it buys the artifact nothing: no
    // terminal stage contributes a field to any schema.
    if (stage.terminal) {
      anyDone = true;
      continue;
    }

    // No turn cap: the checklist alone ends a topic. The user can always
    // /skip a topic or leave (progress is saved), so a strict checker can't
    // trap anyone.
    for (;;) {
      const answer = await io.ask("you");
      if (answer.trim() === "/quit") return { exchange, userWords: userWords(exchange), aborted: true };
      if (answer.trim() === "/simulateAuthorize") {
        io.note("(simulated authorize — closing the node with an empty object)");
        return { exchange, userWords: userWords(exchange), aborted: false, simulated: true };
      }
      if (answer.trim() === "/skip") {
        // A skip before anything was shared ends the WHOLE interview — the
        // remaining topics would probe material that does not exist. The
        // session closes gracefully instead of leaving the node half-open.
        if (!userWords(exchange).trim()) {
          io.note(lang?.code === "ru"
            ? "(шаг пропущен — ничего не рассказано)"
            : "(skipped — nothing was shared for this step)");
          return { exchange, userWords: "", aborted: false, skipped: true };
        }
        io.note(lang?.code === "ru" ? "(идём дальше)" : "(moving on)");
        break;
      }
      messages.push({ role: "user", content: answer });
      exchange.push({ speaker: "user", text: answer });
      io.onTurn?.(exchange, i);

      // The follow-up question is generated speculatively while the checker
      // runs — continuing the topic is the common case, so this halves turn
      // latency. When the checker ends the topic instead, the follow-up is
      // discarded unseen and the next stage opens as before.
      const [check, followUp] = await Promise.all([
        checkStageDone(llm, stage, exchange),
        llm.complete({ tier: "small", system, messages }),
      ]);
      materialSeen ||= check.evidence;
      if (check.skip) {
        // "Let's skip", «пропустим» — the spoken skip works like /skip: with
        // no material anywhere the whole step closes gracefully, otherwise
        // only this topic ends and what was shared moves on to induction.
        if (!anyDone && !materialSeen) {
          io.note(lang?.code === "ru"
            ? "(шаг пропущен — ничего не рассказано)"
            : "(skipped — nothing was shared for this step)");
          return { exchange, userWords: userWords(exchange), aborted: false, skipped: true };
        }
        io.note(lang?.code === "ru" ? "(идём дальше)" : "(moving on)");
        break;
      }
      if (check.done) { anyDone = true; break; }
      messages.push({ role: "assistant", content: followUp });
      exchange.push({ speaker: "interviewer", text: followUp });
      io.say(followUp);
      io.onTurn?.(exchange, i);
    }
  }

  return { exchange, userWords: userWords(exchange), aborted: false, skipped: !anyDone && !materialSeen };
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
    return extractJson(raw) as Record<string, unknown>;
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
  // Words the client said about one model, story or favorite must not be
  // attributed to another. Verbatim cannot see this — a borrowed comparison is
  // still the client's own sentence — so the code compares siblings and flags
  // what was shared. Flagged, never deleted: the client decides whether it
  // belongs (they may well have said it of both).
  const borrowed = borrowedAcrossEntities(result, step.output_schema);
  if (borrowed.length > 0) {
    const prior = ((result as Record<string, unknown>)._verbatim_warnings ?? []) as string[];
    (result as Record<string, unknown>)._verbatim_warnings = [...new Set([...prior, ...borrowed])];
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
  // A withdrawn amend stays in the record but never composes: the user took
  // those words back, and the composer quotes what it is given.
  const live = exchange.filter((e) => e.phase !== "amend_withdrawn");
  // The change conversation belongs in the source — the words the client just
  // said are as quotable as anything from the interview — but it is marked,
  // so a request to fix the draft is never mistaken for an answer about their
  // life.
  const transcript = live.map((e) => {
    const who = e.speaker === "user" ? "user" : "interviewer";
    return e.phase === "amend" ? `[about the draft] ${who}: ${e.text}` : `${who}: ${e.text}`;
  }).join("\n");
  const verbatimSource = [
    ...live.filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");
  const draft: Record<string, unknown> = {};
  for (const step of pb.induce!.steps) {
    io.note(lang?.code === "ru" ? "(собираю…)" : "(putting it together…)");
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
    paths: { type: "array", items: { type: "string" } },
  },
  required: ["action", "say", "directive", "paths"],
  additionalProperties: false,
};

export function amendChatSystem(pb: Playbook, lang?: SessionLang): string {
  return [
    `You are the counselor for the "${pb.title}" step of a career construction session. The user is reviewing a drafted artifact and has asked for a change. Your job is to settle WHAT should change through a short conversation — the rewrite itself happens later, by a separate engine.`,
    [
      "Each turn, return JSON with:",
      '- action "reply" — keep talking: `say` is your next message, asking exactly one question. Clarify when the request is ambiguous or could be applied more than one way; once the change is clear, play back in one or two sentences exactly what will change and ask the user to confirm. Leave `directive` empty.',
      '- action "revise" — the user has clearly confirmed (yes / go ahead / exactly). `directive` compiles every agreed change into one compact instruction for the rewrite engine; `say` is a brief acknowledgment, or empty. `paths` names where the change lands, as dotted paths into the draft — `models.2.similarities`, `guides`, `recollections.0.feeling`. Name the NARROWEST thing that contains it: a single field when the change is confined to that field, the whole item only when it genuinely spans several. Everything you do not name is guaranteed to stay exactly as the user already approved it, so a path wider than the change lets untouched wording be rewritten.',
      '- action "drop" — ONLY when the user has said to leave the draft alone: they took the request back, or they are satisfied as it stands. Frustration is not withdrawal, and neither is a demand to tear the artifact up and rebuild it — that is the widest possible revise. `say` acknowledges briefly; the draft stays. Leave `directive` and `paths` empty.',
    ].join("\n"),
    [
      "Settle the change in as few turns as you can. Reply once to confirm what you understood, then revise. Ask a second question only when the request could genuinely be applied in more than one place and you cannot tell which — and never ask the same thing twice in different words. If the user repeats themselves, insists, or shows frustration, you already have your answer: revise.",
      "You are holding the interview above. Never ask the user to tell you again what they already said in it — read it. \"Use what I told you\", \"rebuild it from the chat\", \"recalculate everything\" are complete instructions on their own: confirm once and revise, with `paths` covering what they named.",
      "Do not raise what the rewrite engine will need — quotes, minimum counts, which field a thing lives in. That is not the user's problem. Settle what they want in their terms; if it truly cannot be built from their words, the rewrite says so afterwards.",
    ].join("\n"),
    "Never rewrite the draft yourself inside `say`, and never put changes into `directive` that the user did not agree to. The draft is already displayed to the user above this conversation — you cannot paste, attach, or send anything, so never say that you have. If they ask to see it, tell them it is shown above and ask what they would like changed.",
    "The passage may only hold the user's own words. If the change would need words they have not said — a comparison they never made, a feeling they never named — do not agree to supply them: ask for them, in their words, and settle the change around what they give you.",
    "Write `say` as plain prose — no markdown, no asterisks — and never name a schema field to the user: speak of the passage in their own terms.",
    lang ? `Write \`say\` in ${lang.instruction}.` : "",
  ].filter(Boolean).join("\n\n");
}

/** Returns the agreed change directive, or null when the user drops the
 * request. The dialogue is appended to `exchange` (marked `phase:"amend"`)
 * so the recompose can quote the user's new words and the saved transcript
 * carries the full session log. */
export interface AgreedChange {
  directive: string;
  /** Where in the artifact it lands — the fence the recomposition runs inside. */
  paths: string[];
}

export async function runAmendChat(
  pb: Playbook,
  llm: LlmAdapter,
  draft: Record<string, unknown>,
  firstComment: string,
  io: SessionIO,
  lang: SessionLang | undefined,
  exchange: ExchangeEntry[],
  persist?: (exchange: ExchangeEntry[]) => void,
): Promise<AgreedChange | null> {
  const start = exchange.length;
  exchange.push({ speaker: "user", text: firstComment, phase: "amend" });
  persist?.(exchange);
  const userAsks = () =>
    exchange.slice(start)
      .filter((e) => e.speaker === "user" && e.phase !== "amend_withdrawn")
      .map((e) => e.text).join("\n");

  // The interview itself. Without it the counselor cannot answer "use what I
  // already told you" and ends up asking the user to repeat things it is
  // holding — which is exactly how one tester's change conversation went.
  const interview = exchange
    .slice(0, start)
    .filter((e) => e.phase !== "amend_withdrawn")
    .map((e) => `${e.speaker === "user" ? "user" : "counselor"}: ${e.text}`)
    .join("\n");

  for (let turn = 0; turn < MAX_AMEND_TURNS; turn++) {
    const convo = exchange
      .slice(start)
      .map((e) => `${e.speaker === "user" ? "user" : "counselor"}: ${e.text}`)
      .join("\n");
    let out: { action?: string; say?: string; directive?: string; paths?: string[] };
    try {
      const raw = await llm.complete({
        tier: "small",
        system: amendChatSystem(pb, lang),
        messages: [{
          role: "user",
          content: `What the user said in the interview:\n${interview}`
            + `\n\nThe draft under review:\n${JSON.stringify(draft, null, 2)}`
            + `\n\nThe change conversation so far:\n${convo}`,
        }],
        jsonSchema: AMEND_TURN_SCHEMA,
        temperature: 0.4,
      });
      out = extractJson(raw) as typeof out;
    } catch {
      // A failed chat turn must never strand the request — fall back to the
      // old immediate behavior with everything the user has asked so far.
      return { directive: userAsks(), paths: [] };
    }
    const say = out.say?.trim() || (out.action === "reply" ? "…" : "");
    if (say) {
      io.say(say);
      exchange.push({ speaker: "interviewer", text: say, phase: "amend" });
      persist?.(exchange);
    }
    if (out.action === "revise") {
      return {
        directive: out.directive?.trim() || userAsks(),
        paths: (out.paths ?? []).map((p) => String(p).trim()).filter(Boolean),
      };
    }
    if (out.action === "drop") {
      // Withdrawn. The words were still said, so they stay in the record —
      // marked, so no later recompose can be steered by a request the user
      // took back (the transcript feeds the composer verbatim).
      for (const e of exchange.slice(start)) e.phase = "amend_withdrawn";
      persist?.(exchange);
      return null;
    }
    const answer = await io.ask("you");
    exchange.push({ speaker: "user", text: answer, phase: "amend" });
    persist?.(exchange);
  }
  return { directive: userAsks(), paths: [] }; // cap reached — revise with everything asked
}

/**
 * Invalidate and recompute: the artifact is composed again from the
 * transcript — which by now contains the change conversation, so the words
 * the client just said are ordinary source material — and then only the
 * agreed parts of that fresh composition are kept. Everything outside the
 * fence stays byte-for-byte what it was, so re-deriving one model cannot
 * quietly empty the guides beside it.
 */
export async function runAmendRecompute(
  pb: Playbook,
  current: Record<string, unknown>,
  change: AgreedChange,
  recompose: (feedback: string) => Promise<Record<string, unknown>>,
  exchange: ExchangeEntry[],
  upstream: Record<string, unknown>,
): Promise<AmendResult> {
  if (change.paths.length === 0) return { content: current, changed: false, summary: "", blocked: "", rejected: [] };
  const schema = artifactSchema(pb);
  const { _verbatim_warnings: _prior, ...clean } = current;

  const fresh = await recompose(change.directive);
  const { next, applied, rejected } = adoptPaths(clean, fresh, change.paths, schema);
  const refused = rejected.map((r) => `${r.op.path}: ${r.reason}`);
  if (applied.length === 0 || JSON.stringify(next) === JSON.stringify(clean)) {
    return { content: current, changed: false, summary: "", blocked: "", rejected: refused };
  }

  const live = exchange.filter((e) => e.phase !== "amend_withdrawn");
  const verbatimSource = [
    ...live.filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");
  const flagged = [...new Set([
    ...verbatimViolations(next, schema, verbatimSource),
    ...borrowedAcrossEntities(next, schema),
  ])];
  if (flagged.length > 0) (next as Record<string, unknown>)._verbatim_warnings = flagged;

  return { content: next, changed: true, summary: "", blocked: "", rejected: refused };
}

/* ── the amend patch ────────────────────────────────────────────────────
 * An agreed change is applied as named edits, not a rewrite. The model that
 * reads the request only has to say WHERE and WHAT; the code does the moving,
 * and can therefore report exactly what happened — including "nothing", which
 * used to come back as an unchanged draft and no explanation at all. */

/**
 * The shape of the whole artifact. An induce run has several steps and the
 * saved object is their union, so a patch judged against one step's schema
 * would call the other step's fields invented and refuse to touch them.
 */
export function artifactSchema(pb: Playbook): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const st of pb.induce?.steps ?? []) {
    const own = (st.output_schema as { properties?: Record<string, unknown> }).properties;
    if (own) Object.assign(properties, own);
  }
  return { type: "object", properties };
}

export function amendPatchSystem(pb: Playbook, schema: Record<string, unknown>, lang?: SessionLang): string {
  return [
    `You are editing a settled artifact from the "${pb.title}" step of a career construction session. The user asked for a change and it has already been talked through and agreed with them. Your job is to say precisely which parts of the artifact change.`,
    "Do not ask the user anything — that conversation is over. Where the agreed change leaves a detail open (exactly where to cut a quote, whether a section should be emptied or an item dropped), take the most faithful reading, make the edit, and tell them what you chose in `summary`.",
    [
      "Return JSON with:",
      '- `ops` — the edits, smallest set that does the job. Each is `{ "op": "set" | "add" | "remove", "path": "...", "value": ... }`.',
      '  Paths are dotted, with numbers for list positions: `models.2.similarities.0`, `guides.1.name`. To append to a list, end the path with `-`: `models.2.similarities.-`. To drop an item, `remove` its exact path.',
      '  Touch nothing the user did not ask about. Do not restate unchanged parts.',
      '- `summary` — one short sentence telling the user what you changed, in their own terms. Never name a schema field.',
      '- `blocked` — leave empty when you made the edits. It has exactly one use: the change would need words the user never said. Then return NO ops and write, in one or two sentences, what you would need to hear. This text is shown to the user as the counselor speaking — address them as "you", never as "the user".',
    ].join("\n"),
    [
      "The user has already agreed to this change — it is your instruction, and it needs no quote of its own. What needs quoting is only what ends up STORED in a field marked x-verbatim: every such string must be an exact quote of the user's own words, from the transcript or the upstream artifacts.",
      "So: removing, reordering, renaming, or trimming are all free. Dividing one long quote into two shorter ones is free as well, as long as each part is still an unbroken stretch of what the user actually said — you are cutting their sentence, not rewriting it.",
      "What you may never do is write in a quote the user never said, or move a phrase the user said about one person, story or favorite onto another. If the change needs words that are not in the transcript, make no edits and use `blocked` to say what you would need to hear from them.",
      "",
      "Two worked examples.",
      'To break the stored quote "I can be counted on. And always finding strength to do right things" into two, cut it where the user paused: `[{"op":"set","path":"models.0.similarities.0","value":"I can be counted on"},{"op":"add","path":"models.0.similarities.-","value":"always finding strength to do right things"}]`. Both halves are still exactly what they said.',
      'To empty a section the schema requires, set it to an empty list rather than removing the field: `[{"op":"set","path":"guides","value":[]}]`.',
    ].join("\n"),
    `The artifact's schema:\n${JSON.stringify(schema, null, 2)}`,
    lang ? `Write \`summary\` and \`blocked\` in ${lang.instruction}.` : "",
  ].filter(Boolean).join("\n\n");
}

export interface AmendResult {
  content: Record<string, unknown>;
  changed: boolean;
  summary: string;
  /** Why nothing changed, in the counselor's voice — empty when it did. */
  blocked: string;
  /** Edits the code refused, for the log; the user hears `blocked` instead. */
  rejected: string[];
}

/**
 * Applies an agreed change to the current draft. Returns the draft untouched
 * when the change cannot be made honestly — with the reason, so the counselor
 * can say it out loud rather than redrawing the same artifact in silence.
 */
export async function runAmendPatch(
  pb: Playbook,
  llm: LlmAdapter,
  current: Record<string, unknown>,
  directive: string,
  exchange: ExchangeEntry[],
  upstream: Record<string, unknown>,
  lang?: SessionLang,
): Promise<AmendResult> {
  const schema = artifactSchema(pb);
  const tier = pb.induce?.steps?.[0]?.model_tier ?? "small";
  // A withdrawn amend stays in the record but never composes: the user took
  // those words back, and the composer quotes what it is given.
  const live = exchange.filter((e) => e.phase !== "amend_withdrawn");
  // The change conversation belongs in the source — the words the client just
  // said are as quotable as anything from the interview — but it is marked,
  // so a request to fix the draft is never mistaken for an answer about their
  // life.
  const transcript = live.map((e) => {
    const who = e.speaker === "user" ? "user" : "interviewer";
    return e.phase === "amend" ? `[about the draft] ${who}: ${e.text}` : `${who}: ${e.text}`;
  }).join("\n");
  const verbatimSource = [
    ...live.filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");

  const { _verbatim_warnings: _priorWarnings, ...clean } = current;
  const raw = await llm.complete({
    tier,
    system: amendPatchSystem(pb, schema, lang),
    messages: [{
      role: "user",
      content: `Transcript:\n${transcript}\n\nThe artifact as it stands:\n${JSON.stringify(clean, null, 2)}`
        + `\n\nThe agreed change:\n${directive}`,
    }],
    jsonSchema: PATCH_SCHEMA,
    maxTokens: INDUCE_MAX_TOKENS,
    temperature: 0.2,
  });
  const out = extractJson(raw) as {
    ops?: PatchOp[]; summary?: string; blocked?: string;
  };

  const ops = Array.isArray(out.ops) ? out.ops : [];
  const blocked = (out.blocked ?? "").trim();
  if (ops.length === 0) return { content: current, changed: false, summary: "", blocked, rejected: [] };

  const { next, applied, rejected } = applyOps(clean, ops, schema);
  const refused = rejected.map((r) => `${r.op.op} ${r.op.path}: ${r.reason}`);
  // Nothing landed: the draft stands, and the user is told, not shown the
  // same artifact again with no word about it. Ops that leave the artifact
  // exactly as it was count as nothing landing — a summary claiming a change
  // that did not happen is the same silence wearing a different face.
  if (applied.length === 0 || JSON.stringify(next) === JSON.stringify(clean)) {
    return { content: current, changed: false, summary: "", blocked, rejected: refused };
  }

  // The same discipline the composer answers to: an edit may not put words in
  // the user's mouth, and may not lend one person's words to another.
  const violations = verbatimViolations(next, schema, verbatimSource);
  const borrowed = borrowedAcrossEntities(next, schema);
  const flagged = [...new Set([...violations, ...borrowed])];
  if (flagged.length > 0) (next as Record<string, unknown>)._verbatim_warnings = flagged;

  return { content: next, changed: true, summary: (out.summary ?? "").trim(), blocked: "", rejected: refused };
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
  opts: {
    existingFirst?: boolean; llm?: LlmAdapter; lang?: SessionLang;
    exchange?: ExchangeEntry[]; skipMode?: boolean;
    /** Sources for the patch step; without them an amend falls back to a rewrite. */
    upstream?: Record<string, unknown>;
    /** Called after each amend turn so a conversation left mid-way is still recorded. */
    persist?: (exchange: ExchangeEntry[]) => void;
    /** Called whenever the presented draft changes, so a death during review
     * re-sends exactly what the user was reading — never a recomposition. */
    persistDraft?: (draft: Record<string, unknown>) => void;
  } = {},
): Promise<Record<string, unknown>> {
  const confirm = pb.confirm!;
  let current = draft;
  let existing = opts.existingFirst ?? false;
  // A skipped step reviews as plain fields (nothing to choose between) and
  // the authorize action says what it really does: skip this step.
  const authLang = opts.skipMode
    ? (opts.lang?.code === "ru" ? "Пропустить этот шаг" : "Skip this step")
    : authorizeLanguage(pb, opts.lang);
  const present = opts.skipMode ? "structured_review" : confirm.present;

  if (io.review) {
    for (;;) {
      const candidates = (current.candidates ?? []) as string[];
      const act = await io.review({
        mode: present,
        draft: current,
        candidates,
        choice_field: confirm.choice_field,
        authorize_language: authLang,
        existing,
        // The playbook decides what the client reads first; without this the
        // review follows whatever order the composer happened to emit.
        field_order: Object.keys((artifactSchema(pb).properties ?? {}) as Record<string, unknown>),
        ...collectVerbatim(pb, current),
      });
      if (act.action === "feedback" || act.action === "reprocess") {
        let feedback = act.action === "feedback" ? act.text : undefined;
        if (act.action === "feedback" && opts.llm) {
          // Talk the change through first; only a confirmed request revises.
          const settled = await runAmendChat(
            pb, opts.llm, current, act.text, io, opts.lang, opts.exchange ?? [], opts.persist,
          );
          if (settled === null) continue; // withdrawn — the draft stands
          feedback = settled.directive;
          // A settled artifact is not rewritten wholesale: the parts the
          // change touches are composed again from the transcript, and the
          // rest is left exactly as the client already approved it. If that
          // moves nothing, the change is made as a direct edit instead —
          // two ways to land it before anyone is told it cannot be done.
          // Candidate steps are different: there the draft IS a wording.
          if (present === "structured_review" && pb.induce?.steps?.length) {
            io.note("(reworking it…)");
            try {
              let amended = await runAmendRecompute(
                pb, current, settled,
                (directive) => reinduce(directive, undefined),
                opts.exchange ?? [], opts.upstream ?? {},
              );
              if (!amended.changed) {
                amended = await runAmendPatch(
                  pb, opts.llm, current, feedback,
                  opts.exchange ?? [], opts.upstream ?? {}, opts.lang,
                );
              }
              if (amended.changed) {
                current = amended.content;
                existing = false;
                opts.persistDraft?.(current);
                if (amended.summary) io.say(amended.summary);
                continue;
              }
              // Refused, honestly: say why rather than redraw the same thing.
              if (amended.blocked) {
                io.say(amended.blocked);
                if (opts.exchange) opts.exchange.push({ speaker: "interviewer", text: amended.blocked, phase: "amend" });
                opts.persist?.(opts.exchange ?? []);
                continue;
              }
            } catch { /* both routes failed outright — rewrite instead */ }
          }
        }
        io.note("(reworking it…)");
        // A feedback revision hands the current draft over as `prior` so the
        // recomposer keeps everything that was not discussed — the amend
        // conversation promises "only this changes", and a from-scratch
        // recompose is free to drop fields (it silently emptied guides in
        // testing). Reprocess deliberately recomposes from sources alone.
        current = await reinduce(feedback, act.action === "feedback" ? current : undefined);
        existing = false;
        opts.persistDraft?.(current);
        continue;
      }
      if (present === "candidates") {
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
    io.say(authLang);
    return current;
  }

  // structured_review
  for (;;) {
    io.say("Draft artifact — your words, organized:");
    io.say(JSON.stringify(current, null, 2));
    const answer = (await io.ask("press enter to authorize, or describe what to fix")).trim();
    if (answer === "") {
      io.say(authLang);
      return current;
    }
    io.note("(reworking it…)");
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
