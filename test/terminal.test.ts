/**
 * A terminal stage gives rather than asks. It must deliver its utterance and
 * end elicitation without waiting: the closing send-off hands the motto back,
 * and asking the user to reply to a farewell only stands between them and the
 * closing ceremony. Nothing a terminal stage could collect reaches an artifact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runElicit } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Playbook } from "../src/types.ts";

const CLOSING = {
  id: "closing", version: "0", kind: "conversation", sector: "action",
  title: "Did we get there?", purpose: "", consumes: [], invalidates: [],
  elicit: {
    persona: "warm", guardrails: [],
    stages: [
      { id: "verdict", goal: "a verdict", opening: "Did we get there?", probes: [], done_when: ["a verdict"] },
      { id: "sendoff", goal: "hand the motto back", opening: "One last thing.", probes: [], done_when: ["n/a"], terminal: true },
    ],
  },
  induce: { steps: [] },
  confirm: { present: "structured_review", authorize_language: "Keep this record" },
} as unknown as Playbook;

/** Answers the first stage, then explodes if asked anything further. */
function ioThatAnswersOnce(said: string[], asked: string[]) {
  let answers = 1;
  return {
    say: (t: string) => said.push(t),
    sayAnchor: (t: string) => said.push(t),
    note: () => {},
    ask: async (p: string) => {
      asked.push(p);
      if (answers-- > 0) return "Yes, we got there.";
      throw new Error("the send-off must not wait for an answer");
    },
  };
}

const CHECK_PASSES = JSON.stringify({
  results: [{ index: 0, satisfied: true, required_count: null, entities: [] }],
  skip_requested: false, skip_quote: "",
});

/** The checker and the interviewer share one adapter; tell them apart by the
 * checker's JSON-only system prompt. */
const splitAdapter = (sendoff: string): LlmAdapter => ({
  complete: async (req: { system?: string }) =>
    (req.system ?? "").includes("Return JSON only") ? CHECK_PASSES : sendoff,
} as unknown as LlmAdapter);

test("a terminal stage delivers its utterance and closes without asking", async () => {
  const said: string[] = [];
  const asked: string[] = [];
  const sendoff = "One last thing. Your own words: \"Let's sort this out.\" Wishing you well.";

  const out = await runElicit(CLOSING, splitAdapter(sendoff), ioThatAnswersOnce(said, asked) as never);

  assert.equal(out.aborted, false, "a terminal close is not an abort");
  assert.equal(out.skipped ?? false, false, "a terminal close is not a skip");
  // Exactly one ask: the verdict stage. The send-off never reaches io.ask.
  assert.equal(asked.length, 1, `send-off must not ask; asks = ${asked.length}`);
  // The send-off still reaches the user and still lands in the transcript.
  const last = out.exchange[out.exchange.length - 1];
  assert.equal(last.speaker, "interviewer", "the last word belongs to the send-off");
  assert.ok(said.length >= 2, "the send-off must still be spoken");
});

test("a stuck send-off session resolves on resume without a model call", async () => {
  // The shape left behind before terminal stages existed: the send-off was
  // delivered and the engine sat on io.ask forever. Reopening must close it.
  const exchange = [
    { speaker: "interviewer" as const, text: "Did we get there?" },
    { speaker: "user" as const, text: "Yes, we got there." },
    { speaker: "interviewer" as const, text: "One last thing. Wishing you well." },
  ];
  const asked: string[] = [];
  const io = {
    say: () => {}, sayAnchor: () => {}, note: () => {},
    ask: async (p: string) => { asked.push(p); throw new Error("resume must not ask"); },
  };
  const never: LlmAdapter = {
    complete: async () => { throw new Error("resuming a delivered send-off must not call the model"); },
  } as LlmAdapter;

  const out = await runElicit(CLOSING, never, io as never, { exchange, stageIndex: 1 });

  assert.equal(asked.length, 0, "a delivered send-off must not ask again");
  assert.equal(out.exchange.length, 3, "resume must not append a turn");
});
