/**
 * A session that dies between an answer and its verdict must right itself on
 * resume: judge the pending answer first, and only then decide whether the
 * topic continues or the next one opens. Before this, resume welcomed the
 * user back into a finished topic — the model spoke the transition itself
 * while the checker kept grading the old checklist, and the step read as
 * stuck with two questions welded together (a tester's afternoon, verbatim).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runElicit } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Playbook } from "../src/types.ts";

const PB = {
  id: "t", version: "0", kind: "conversation", sector: "interview",
  title: "T", purpose: "", consumes: [], invalidates: [],
  elicit: {
    persona: "warm", guardrails: [],
    stages: [
      { id: "one", goal: "g1", opening: "First question?", probes: [], done_when: ["answered one"] },
      { id: "two", goal: "g2", opening: "Second question?", probes: [], done_when: ["answered two"] },
    ],
  },
} as unknown as Playbook;

const checkerDone = (done: boolean) => JSON.stringify({
  skip_requested: false, skip_quote: "",
  results: [{ index: 0, satisfied: done, required_count: null,
    entities: [{ name: "answer", evidence: "quote", satisfied: done }] }],
});

/** Routes scripted responses by call shape: checker calls carry the results schema. */
function shapedLlm(script: { checker: string[]; questions: string[] }, log: string[]): LlmAdapter {
  return {
    complete: async (opts: { jsonSchema?: { properties?: Record<string, unknown> } }) => {
      const isChecker = Boolean(opts.jsonSchema?.properties?.results);
      log.push(isChecker ? "checker" : "question");
      return isChecker ? (script.checker.shift() ?? checkerDone(false)) : (script.questions.shift() ?? "Q?");
    },
  } as unknown as LlmAdapter;
}

const RESUME = {
  exchange: [
    { speaker: "interviewer" as const, text: "First question?" },
    { speaker: "user" as const, text: "Here is my full answer to topic one." },
  ],
  stageIndex: 0,
};

test("a finished answer advances the stage on resume — no welcome-back into a done topic", async () => {
  const said: string[] = [];
  const log: string[] = [];
  const llm = shapedLlm({ checker: [checkerDone(true)], questions: ["Now, the second question?"] }, log);
  const io = {
    say: (t: string) => said.push(t),
    sayAnchor: (t: string) => said.push(t),
    note: () => {},
    ask: async () => "/quit", // end as soon as topic two is on the table
  };
  await runElicit(PB, llm, io as never, RESUME, undefined, {});
  assert.equal(log[0], "checker", "the pending answer must be judged before anything is said");
  assert.deepEqual(said, ["Now, the second question?"],
    "the only speech is topic two's own transition question");
});

test("an unfinished answer still gets the welcome-back, inside its own topic", async () => {
  const said: string[] = [];
  const log: string[] = [];
  const llm = shapedLlm({ checker: [checkerDone(false)], questions: ["Welcome back — go on?"] }, log);
  const io = {
    say: (t: string) => said.push(t),
    sayAnchor: (t: string) => said.push(t),
    note: () => {},
    ask: async () => "/quit",
  };
  await runElicit(PB, llm, io as never, RESUME, undefined, {});
  assert.equal(log[0], "checker");
  assert.deepEqual(said, ["Welcome back — go on?"], "the topic continues where it left off");
});
