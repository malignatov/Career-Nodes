import type {
  Artifact, ChatTurn, ExchangeEntry, InduceStep, Playbook, Stage,
} from "./types.js";
import type { LlmAdapter } from "./llm.js";
import { verbatimViolations } from "./verbatim.js";

export interface SessionIO {
  say(text: string): void;
  note(text: string): void;
  ask(prompt: string): Promise<string>;
}

const MAX_TURNS_PER_STAGE = 12;

function interviewerSystem(pb: Playbook, stage: Stage): string {
  const probes = (stage.probes ?? [])
    .map((p) => `- When ${p.when}: ${p.then}`)
    .join("\n");
  return [
    `You are the interviewer for the "${pb.title}" step of a career construction session.`,
    pb.elicit!.persona.trim(),
    "Hard rules you must never break:",
    ...pb.elicit!.guardrails.map((g) => `- ${g}`),
    `Current topic goal: ${stage.goal}`,
    `Anchor question for this topic (use this wording, adapted only lightly to the flow): ${stage.opening.trim()}`,
    probes ? `Probe guidance:\n${probes}` : "",
    "Ask exactly one question per message and keep each message to a few sentences.",
    "Messages wrapped in [brackets] are stage directions from the application, not the user. Never mention them.",
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
    system:
      "You audit an interview transcript against a checklist. Judge only from what the user actually said. Return JSON only.",
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
): Promise<ElicitResult> {
  const exchange: ExchangeEntry[] = [];
  const messages: ChatTurn[] = [];

  for (const [i, stage] of pb.elicit!.stages.entries()) {
    const system = interviewerSystem(pb, stage);
    messages.push({
      role: "user",
      content:
        i === 0
          ? "[The session begins. Greet the user in one short sentence, then ask your anchor question.]"
          : `[Topic complete. Move on to the next topic and ask its anchor question: ${stage.opening.trim()}]`,
    });

    let turns = 0;
    while (turns < MAX_TURNS_PER_STAGE) {
      const question = await llm.complete({ tier: "small", system, messages });
      messages.push({ role: "assistant", content: question });
      exchange.push({ speaker: "interviewer", text: question });
      io.say(question);

      const answer = await io.ask("you");
      if (answer.trim() === "/quit") return { exchange, userWords: userWords(exchange), aborted: true };
      if (answer.trim() === "/skip") {
        io.note(`(skipped remaining checks for topic "${stage.id}")`);
        break;
      }
      messages.push({ role: "user", content: answer });
      exchange.push({ speaker: "user", text: answer });
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

async function runInduceStep(
  llm: LlmAdapter,
  pb: Playbook,
  step: InduceStep,
  transcript: string,
  upstream: Record<string, unknown>,
  feedback: string | undefined,
): Promise<Record<string, unknown>> {
  const system = [
    `You are the induction engine for the "${pb.title}" step of a career construction session.`,
    `Task: ${step.task.trim()}`,
    "Every string in a field marked x-verbatim in the schema must be an exact quote of the user's own words from the transcript — never paraphrase those.",
    ...(step.validation ?? []).map((v) => `Constraint: ${v}`),
    "Return only JSON matching the schema.",
  ].join("\n\n");

  const upstreamBlock = Object.keys(upstream).length
    ? `\n\nAuthorized upstream artifacts:\n${JSON.stringify(upstream, null, 2)}`
    : "";
  const feedbackBlock = feedback ? `\n\nUser feedback on the previous draft (address it):\n${feedback}` : "";

  const attempt = async (extra: string): Promise<Record<string, unknown>> => {
    const raw = await llm.complete({
      tier: step.model_tier,
      system,
      messages: [
        { role: "user", content: `Transcript:\n${transcript}${upstreamBlock}${feedbackBlock}${extra}` },
      ],
      jsonSchema: step.output_schema,
      maxTokens: 8192,
    });
    return JSON.parse(raw.replace(/^```(json)?\n?|\n?```$/g, "")) as Record<string, unknown>;
  };

  let result = await attempt("");
  const userOnly = transcript
    .split("\n")
    .filter((l) => l.startsWith("user:"))
    .join("\n");
  let violations = verbatimViolations(result, step.output_schema, userOnly);
  if (violations.length > 0) {
    result = await attempt(
      `\n\nYour previous attempt contained strings that are not exact quotes of the user. Fix these by quoting the user's actual words:\n${violations
        .map((v) => `- "${v}"`)
        .join("\n")}`,
    );
    violations = verbatimViolations(result, step.output_schema, userOnly);
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
): Promise<Record<string, unknown>> {
  const transcript = exchange.map((e) => `${e.speaker === "user" ? "user" : "interviewer"}: ${e.text}`).join("\n");
  const draft: Record<string, unknown> = {};
  for (const step of pb.induce!.steps) {
    io.note(`(inducing: ${step.id}…)`);
    Object.assign(draft, await runInduceStep(llm, pb, step, transcript, upstream, feedback));
  }
  return draft;
}

export async function runConfirm(
  pb: Playbook,
  draft: Record<string, unknown>,
  io: SessionIO,
  reinduce: (feedback: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const confirm = pb.confirm!;
  let current = draft;

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
