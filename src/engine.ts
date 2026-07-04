import type {
  Artifact, ChatTurn, ExchangeEntry, InduceStep, Playbook, Stage,
} from "./types.ts";
import type { LlmAdapter } from "./llm.ts";
import { gatherMarked, verbatimViolations } from "./verbatim.ts";

export interface ReviewPayload {
  mode: "candidates" | "structured_review";
  draft: Record<string, unknown>;
  candidates: string[];
  choice_field?: string;
  authorize_language: string;
  verified_quotes: string[];
  warnings: string[];
}

export type ReviewAction =
  | { action: "authorize"; value?: string }
  | { action: "feedback"; text: string };

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

function stageOpening(stage: Stage, lang?: SessionLang): string {
  const localized = lang ? stage.opening_i18n?.[lang.code] : undefined;
  return (localized ?? stage.opening).trim();
}

export interface ResumeState {
  exchange: ExchangeEntry[];
  stageIndex: number;
}

const MAX_TURNS_PER_STAGE = 12;

export const CHECKER_SYSTEM =
  "You audit an interview transcript against a checklist. Judge only from what the user actually said. Return JSON only.";

export function interviewerSystem(pb: Playbook, stage: Stage, lang?: SessionLang): string {
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
  ].filter(Boolean).join("\n\n");
}

async function checkStageDone(
  llm: LlmAdapter,
  stage: Stage,
  exchange: ExchangeEntry[],
): Promise<boolean> {
  const transcript = exchange.map((e) => `${e.speaker}: ${e.text}`).join("\n");
  const checklist = stage.done_when.map((d, i) => `${i}. ${d}`).join("\n");
  const raw = await llm.complete({
    tier: "small",
    system: CHECKER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Transcript:\n${transcript}\n\nChecklist:\n${checklist}\n\nFor each item, is it satisfied?`,
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
            required: ["index", "satisfied"],
            properties: {
              index: { type: "integer" },
              satisfied: { type: "boolean" },
            },
          },
        },
      },
    },
  });
  try {
    const parsed = JSON.parse(raw) as { results: { satisfied: boolean }[] };
    return parsed.results.length > 0 && parsed.results.every((r) => r.satisfied);
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
    const system = interviewerSystem(pb, stage, lang);
    let skipGenerate = false;

    if (i === 0 && exchange.length === 0) {
      // The session opener is deterministic: the anchor question is meant to be
      // asked of everyone, verbatim — no model call, no latency, no variation.
      const opener = `${GREETINGS[lang?.code ?? "en"] ?? GREETINGS.en}\n\n${stageOpening(stage, lang)}`;
      messages.push({ role: "assistant", content: opener });
      exchange.push({ speaker: "interviewer", text: opener });
      (io.sayAnchor ?? io.say)(opener);
      skipGenerate = true;
    } else {
      messages.push({
        role: "user",
        content: resuming
          ? "[The session was interrupted earlier and has just been resumed. Welcome the user back in one short sentence and continue this topic where it left off.]"
          : `[Topic complete. Move on to the next topic and ask its anchor question: ${stageOpening(stage, lang)}]`,
      });
      resuming = false;
    }

    let turns = 0;
    while (turns < MAX_TURNS_PER_STAGE) {
      if (!skipGenerate) {
        const question = await llm.complete({ tier: "small", system, messages });
        messages.push({ role: "assistant", content: question });
        exchange.push({ speaker: "interviewer", text: question });
        io.say(question);
      }
      skipGenerate = false;

      const answer = await io.ask("you");
      if (answer.trim() === "/quit") return { exchange, userWords: userWords(exchange), aborted: true };
      if (answer.trim() === "/skip") {
        io.note(`(skipped remaining checks for topic "${stage.id}")`);
        break;
      }
      messages.push({ role: "user", content: answer });
      exchange.push({ speaker: "user", text: answer });
      io.onTurn?.(exchange, i);
      turns++;

      if (await checkStageDone(llm, stage, exchange)) break;
    }
    if (turns >= MAX_TURNS_PER_STAGE) {
      io.note(`(topic "${stage.id}" reached its turn limit; moving on)`);
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

function stringValuesDeep(v: unknown): string[] {
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
): Promise<Record<string, unknown>> {
  const system = induceStepSystem(pb, step, lang);

  const sourceBlock = transcript
    ? `Transcript:\n${transcript}`
    : "There is no interview transcript for this step — compose strictly from the upstream artifacts below.";
  const upstreamBlock = Object.keys(upstream).length
    ? `\n\nAuthorized upstream artifacts:\n${JSON.stringify(upstream, null, 2)}`
    : "";
  const feedbackBlock = feedback ? `\n\nUser feedback on the previous draft (address it):\n${feedback}` : "";

  const attempt = async (extra: string): Promise<Record<string, unknown>> => {
    const raw = await llm.complete({
      tier: step.model_tier,
      system,
      messages: [
        { role: "user", content: `${sourceBlock}${upstreamBlock}${feedbackBlock}${extra}` },
      ],
      jsonSchema: step.output_schema,
      maxTokens: 8192,
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
): Promise<Record<string, unknown>> {
  const transcript = exchange.map((e) => `${e.speaker === "user" ? "user" : "interviewer"}: ${e.text}`).join("\n");
  const verbatimSource = [
    ...exchange.filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");
  const draft: Record<string, unknown> = {};
  for (const step of pb.induce!.steps) {
    io.note(`(inducing: ${step.id}…)`);
    Object.assign(draft, await runInduceStep(llm, pb, step, transcript, upstream, verbatimSource, feedback, lang));
  }
  return draft;
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
  reinduce: (feedback: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const confirm = pb.confirm!;
  let current = draft;

  if (io.review) {
    for (;;) {
      const candidates = (current.candidates ?? []) as string[];
      const act = await io.review({
        mode: confirm.present,
        draft: current,
        candidates,
        choice_field: confirm.choice_field,
        authorize_language: confirm.authorize_language.trim(),
        ...collectVerbatim(pb, current),
      });
      if (act.action === "feedback") {
        io.note("(revising…)");
        current = await reinduce(act.text);
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
    current = await reinduce(answer);
  }
}

export function toArtifact(pb: Playbook, content: Record<string, unknown>): Artifact {
  return {
    playbook_id: pb.id,
    playbook_version: pb.version,
    authorized_at: new Date().toISOString(),
    content,
  };
}
