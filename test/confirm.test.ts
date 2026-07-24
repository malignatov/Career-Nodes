/**
 * The runConfirm state machine with a scripted IO and a fake LLM: the amend
 * conversation, the drop-scrub, prior-draft forwarding, reprocess. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConfirm } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { ExchangeEntry, Playbook } from "../src/types.ts";

const PB = {
  id: "t", title: "Test step",
  confirm: { present: "structured_review", authorize_language: "Authorize?" },
} as unknown as Playbook;

/** Scripted surface: review resolves from a queue; ask likewise. */
function makeIO(reviews: unknown[], asks: string[] = []) {
  const said: string[] = [];
  const noted: string[] = [];
  return {
    io: {
      say: (t: string) => said.push(t),
      note: (t: string) => noted.push(t),
      ask: async () => asks.shift() ?? "",
      review: async () => reviews.shift(),
    },
    said, noted,
  };
}

const chatTurn = (obj: unknown) => JSON.stringify(obj);
/** Fake LLM: each complete() call pops the next scripted raw response. */
const makeLlm = (responses: string[]): LlmAdapter =>
  ({ complete: async () => responses.shift() ?? "{}" }) as LlmAdapter;

test("authorize passes the current draft through untouched", async () => {
  const { io } = makeIO([{ action: "authorize" }]);
  const out = await runConfirm(PB, { a: 1 }, io as never, async () => ({ a: 2 }), {});
  assert.deepEqual(out, { a: 1 });
});

test("amend: conversation → confirm → reinduce gets the directive AND the current draft as prior", async () => {
  const { io, said } = makeIO(
    [{ action: "feedback", text: "make it warmer" }, { action: "authorize" }],
    ["yes, do it"],
  );
  const llm = makeLlm([
    chatTurn({ action: "reply", say: "Warmer how — softer wording?", directive: "" }),
    chatTurn({ action: "revise", say: "Done.", directive: "soften the wording throughout" }),
  ]);
  const exchange: ExchangeEntry[] = [{ speaker: "user", text: "original interview answer" }];
  const calls: unknown[][] = [];
  const out = await runConfirm(
    PB, { text: "v1" }, io as never,
    async (feedback, prior) => { calls.push([feedback, prior]); return { text: "v2" }; },
    { llm, exchange },
  );
  assert.deepEqual(out, { text: "v2" });
  assert.deepEqual(calls, [["soften the wording throughout", { text: "v1" }]]);
  // the dialogue joined the exchange, marked as amend turns
  const amend = exchange.filter((e) => e.phase === "amend").map((e) => [e.speaker, e.text]);
  assert.deepEqual(amend, [
    ["user", "make it warmer"],
    ["interviewer", "Warmer how — softer wording?"],
    ["user", "yes, do it"],
    ["interviewer", "Done."],
  ]);
  assert.ok(said.includes("Warmer how — softer wording?"));
});

test("amend: drop scrubs the conversation from the exchange and never reinduces", async () => {
  const { io } = makeIO(
    [{ action: "feedback", text: "change X" }, { action: "authorize" }],
    ["actually, never mind"],
  );
  const llm = makeLlm([
    chatTurn({ action: "reply", say: "Change X to what?", directive: "" }),
    chatTurn({ action: "drop", say: "Kept as it is.", directive: "" }),
  ]);
  const exchange: ExchangeEntry[] = [{ speaker: "user", text: "kept interview turn" }];
  let reinduced = 0;
  const out = await runConfirm(
    PB, { text: "v1" }, io as never,
    async () => { reinduced++; return { text: "v2" }; },
    { llm, exchange },
  );
  assert.deepEqual(out, { text: "v1" }); // the draft stood
  assert.equal(reinduced, 0);
  // the withdrawn conversation left no trace in the composition source
  assert.deepEqual(exchange, [{ speaker: "user", text: "kept interview turn" }]);
});

test("amend: a broken chat turn falls back to the raw request (old behavior)", async () => {
  const { io } = makeIO([{ action: "feedback", text: "raw request" }, { action: "authorize" }]);
  const llm = makeLlm(["definitely not json"]);
  const calls: unknown[][] = [];
  await runConfirm(
    PB, { text: "v1" }, io as never,
    async (feedback, prior) => { calls.push([feedback, prior]); return { text: "v2" }; },
    { llm, exchange: [] },
  );
  assert.deepEqual(calls, [["raw request", { text: "v1" }]]);
});

test("reprocess reinduces from sources: no feedback, no prior", async () => {
  const { io } = makeIO([{ action: "reprocess" }, { action: "authorize" }]);
  const calls: unknown[][] = [];
  await runConfirm(
    PB, { text: "v1" }, io as never,
    async (feedback, prior) => { calls.push([feedback, prior]); return { text: "v2" }; },
    { llm: makeLlm([]), exchange: [] },
  );
  assert.deepEqual(calls, [[undefined, undefined]]);
});

test("candidates mode: authorize picks the chosen wording into the choice field", async () => {
  const pb = {
    id: "t", title: "T",
    confirm: { present: "candidates", choice_field: "statement", authorize_language: "ok" },
  } as unknown as Playbook;
  const { io } = makeIO([{ action: "authorize", value: "picked wording" }]);
  const out = await runConfirm(
    pb, { candidates: ["a", "b"], extra: 1 }, io as never, async () => ({}), {},
  );
  assert.deepEqual(out, { statement: "picked wording", extra: 1 });
});
