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

test("amend: a withdrawn request is kept in the record, marked, and never reinduces", async () => {
  const { io } = makeIO(
    [{ action: "feedback", text: "change X" }, { action: "authorize" }],
    ["actually, never mind"],
  );
  const llm = makeLlm([
    chatTurn({ action: "reply", say: "Change X to what?", directive: "" }),
    chatTurn({ action: "drop", say: "Kept as it is.", directive: "" }),
  ]);
  const exchange: ExchangeEntry[] = [{ speaker: "user", text: "kept interview turn" }];
  const saves: number[] = [];
  let reinduced = 0;
  const out = await runConfirm(
    PB, { text: "v1" }, io as never,
    async () => { reinduced++; return { text: "v2" }; },
    { llm, exchange, persist: (ex) => saves.push(ex.length) },
  );
  assert.deepEqual(out, { text: "v1" }); // the draft stood
  assert.equal(reinduced, 0);
  // It was said, so it stays — marked, so no recompose can be steered by it.
  assert.deepEqual(exchange.map((e) => [e.phase ?? "-", e.speaker, e.text]), [
    ["-", "user", "kept interview turn"],
    ["amend_withdrawn", "user", "change X"],
    ["amend_withdrawn", "interviewer", "Change X to what?"],
    ["amend_withdrawn", "user", "actually, never mind"],
    ["amend_withdrawn", "interviewer", "Kept as it is."],
  ]);
  // …and it reached disk while it was happening, not only at authorization.
  assert.ok(saves.length >= 4, `the amend was saved ${saves.length} times, want one per turn`);
});

test("amend: every turn is written down as it happens", async () => {
  const { io } = makeIO(
    [{ action: "feedback", text: "make it warmer" }, { action: "authorize" }],
    ["yes, do it"],
  );
  const llm = makeLlm([
    chatTurn({ action: "reply", say: "Warmer how?", directive: "" }),
    chatTurn({ action: "revise", say: "Done.", directive: "soften it" }),
  ]);
  const exchange: ExchangeEntry[] = [];
  // A client who talks a change through and then walks away used to come
  // back to a record that ended at the interview.
  const snapshots: string[][] = [];
  await runConfirm(
    PB, { text: "v1" }, io as never, async () => ({ text: "v2" }),
    { llm, exchange, persist: (ex) => snapshots.push(ex.map((e) => e.text)) },
  );
  assert.deepEqual(snapshots[0], ["make it warmer"]);
  assert.deepEqual(snapshots.at(-1), ["make it warmer", "Warmer how?", "yes, do it", "Done."]);
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

test("the counselor is holding the interview when a change is discussed", async () => {
  // Without it, "use what I already told you" is unanswerable: one tester
  // spent eighteen turns being asked to repeat things the engine had on disk.
  const { io } = makeIO([{ action: "feedback", text: "use what I told you about Hitman" }, { action: "authorize" }]);
  const prompts: string[] = [];
  const llm = {
    complete: async (opts: { messages: { content: string }[] }) => {
      prompts.push(opts.messages[0].content);
      return chatTurn({ action: "drop", say: "Kept.", directive: "", paths: [] });
    },
  } as unknown as LlmAdapter;
  const exchange: ExchangeEntry[] = [
    { speaker: "interviewer", text: "And now Hitman — what was he like?" },
    { speaker: "user", text: "He does the work so clean. Highly ethical." },
  ];
  await runConfirm(PB, { text: "v1" }, io as never, async () => ({ text: "v2" }), { llm, exchange });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /He does the work so clean/, "the interview never reached the counselor");
  assert.match(prompts[0], /use what I told you about Hitman/, "the change request is missing");
  assert.match(prompts[0], /"text": "v1"/, "the draft under review is missing");
});
