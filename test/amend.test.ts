/**
 * What the client experiences when they ask for a change: the artifact is
 * edited, not regenerated — and when the change cannot be made from their own
 * words, they are told. The old path answered a refusal with an unchanged
 * draft and no explanation, which read as "the engine ignored me".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAmendPatch, runConfirm } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { ExchangeEntry, InduceStep, Playbook } from "../src/types.ts";

const STEP = {
  id: "extract",
  task: "extract",
  model_tier: "small",
  output_schema: {
    type: "object",
    properties: {
      models: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            similarities: { type: "array", "x-own": true, items: { type: "string", "x-verbatim": true } },
          },
        },
      },
    },
  },
} as unknown as InduceStep;

const PB = {
  id: "role_models", title: "Who you looked up to",
  induce: { steps: [STEP] },
  confirm: { present: "structured_review", authorize_language: "Authorize?" },
} as unknown as Playbook;

const scripted = (payload: unknown): LlmAdapter =>
  ({ complete: async () => JSON.stringify(payload) }) as LlmAdapter;

const EXCHANGE: ExchangeEntry[] = [
  { speaker: "user", text: "The elephant. I see what is possible where others see a wall." },
  { speaker: "user", text: "Michael. He never stops." },
];

const DRAFT = {
  models: [
    { name: "the elephant", similarities: ["I see what is possible"] },
    { name: "Michael", similarities: [] },
  ],
};

test("an agreed edit lands on exactly the named place", async () => {
  const out = await runAmendPatch(
    PB,
    scripted({
      summary: "Added what you said about Michael.",
      blocked: "",
      ops: [{ op: "add", path: "models.1.similarities.-", value: "He never stops" }],
    }),
    DRAFT, "add Michael's similarity", EXCHANGE, {},
  );
  assert.equal(out.changed, true);
  assert.deepEqual(out.content.models[1].similarities, ["He never stops"]);
  assert.deepEqual(out.content.models[0], DRAFT.models[0]); // untouched
  assert.equal(out.summary, "Added what you said about Michael.");
});

test("a change the transcript cannot support comes back with the reason, not silence", async () => {
  const out = await runAmendPatch(
    PB,
    scripted({
      summary: "",
      blocked: "You never told me how you're like Hitman — say a little about that and I'll add it.",
      ops: [],
    }),
    DRAFT, "fill in the third model like the others", EXCHANGE, {},
  );
  assert.equal(out.changed, false);
  assert.deepEqual(out.content, DRAFT);
  assert.match(out.blocked, /never told me/);
});

test("edits that leave the artifact exactly as it was are not a change", async () => {
  // The model sometimes answers an impossible request with busywork — setting
  // empty lists to empty — and a cheerful summary. A change that changed
  // nothing is the old silence wearing a different face.
  const out = await runAmendPatch(
    PB,
    scripted({
      summary: "Confirmed Michael's similarities stay empty.",
      blocked: "",
      ops: [{ op: "set", path: "models.1.similarities", value: [] }],
    }),
    DRAFT, "fill in the second model", EXCHANGE, {},
  );
  assert.equal(out.changed, false);
  assert.equal(out.summary, "");
  assert.deepEqual(out.content, DRAFT);
});

test("an edit that puts words in the client's mouth is flagged, not accepted quietly", async () => {
  const out = await runAmendPatch(
    PB,
    scripted({
      summary: "Added a similarity.",
      blocked: "",
      ops: [{ op: "add", path: "models.1.similarities.-", value: "he is relentlessly driven" }],
    }),
    DRAFT, "add something about Michael", EXCHANGE, {},
  );
  assert.equal(out.changed, true);
  assert.deepEqual(out.content._verbatim_warnings, ["he is relentlessly driven"]);
});

test("an edit that lends one model's words to another is flagged too", async () => {
  const out = await runAmendPatch(
    PB,
    scripted({
      summary: "Added a similarity.",
      blocked: "",
      ops: [{ op: "add", path: "models.1.similarities.-", value: "I see what is possible" }],
    }),
    DRAFT, "add something about Michael", EXCHANGE, {},
  );
  assert.equal(out.changed, true);
  assert.deepEqual(out.content._verbatim_warnings, ["I see what is possible"]);
});

/** Scripted surface: review resolves from a queue; ask likewise. */
function makeIO(reviews: unknown[], asks: string[] = []) {
  const said: string[] = [];
  return {
    io: {
      say: (t: string) => said.push(t),
      note: () => {},
      ask: async () => asks.shift() ?? "",
      review: async () => reviews.shift(),
    },
    said,
  };
}

test("the review loop patches a settled artifact instead of recomposing it", async () => {
  const { io, said } = makeIO(
    [{ action: "feedback", text: "add Michael's similarity" }, { action: "authorize" }],
    ["yes please"],
  );
  const responses = [
    JSON.stringify({ action: "reply", say: "Add what exactly?", directive: "" }),
    JSON.stringify({ action: "revise", say: "", directive: "add Michael's similarity" }),
    JSON.stringify({
      summary: "Added what you said about Michael.",
      blocked: "",
      ops: [{ op: "add", path: "models.1.similarities.-", value: "He never stops" }],
    }),
  ];
  const llm = { complete: async () => responses.shift() ?? "{}" } as LlmAdapter;
  let recomposed = 0;
  const exchange = [...EXCHANGE];
  const out = await runConfirm(
    PB, structuredClone(DRAFT), io as never,
    async () => { recomposed++; return { models: [] }; },
    { llm, exchange, upstream: {} },
  );
  assert.equal(recomposed, 0, "a settled artifact must be edited, not regenerated");
  assert.deepEqual(out.models[1].similarities, ["He never stops"]);
  assert.ok(said.includes("Added what you said about Michael."), `the change was never announced: ${said.join(" | ")}`);
});

test("a refusal is spoken and recorded, and the draft stands", async () => {
  const { io, said } = makeIO(
    [{ action: "feedback", text: "fill in the third one" }, { action: "authorize" }],
    ["yes please"],
  );
  const refusal = "You never told me how you're like Hitman — say a little about that and I'll add it.";
  const responses = [
    JSON.stringify({ action: "reply", say: "Fill in what?", directive: "" }),
    JSON.stringify({ action: "revise", say: "", directive: "fill in the third model" }),
    JSON.stringify({ summary: "", blocked: refusal, ops: [] }),
  ];
  const llm = { complete: async () => responses.shift() ?? "{}" } as LlmAdapter;
  const exchange = [...EXCHANGE];
  const out = await runConfirm(
    PB, structuredClone(DRAFT), io as never, async () => ({ models: [] }),
    { llm, exchange, upstream: {} },
  );
  assert.deepEqual(out, DRAFT); // nothing moved
  assert.ok(said.includes(refusal), `the client was never told why: ${said.join(" | ")}`);
  assert.equal(exchange.at(-1)?.text, refusal, "the refusal belongs in the record");
});

/* ── invalidate and recompute, fenced to what was agreed ───────────────── */

test("a change recomposes its own part and leaves everything else alone", async () => {
  const { io, said } = makeIO(
    [{ action: "feedback", text: "we missed Michael's similarity" }, { action: "authorize" }],
    ["I also never stop when it matters"],
  );
  const responses = [
    JSON.stringify({ action: "reply", say: "What would you say it is?", directive: "", paths: [] }),
    JSON.stringify({
      action: "revise", say: "Got it.",
      directive: "add Michael's similarity from what the client just said",
      paths: ["models.1"],
    }),
  ];
  const llm = { complete: async () => responses.shift() ?? "{}" } as LlmAdapter;
  // The recomposition re-derives the whole artifact, first model included.
  const RECOMPOSED = {
    models: [
      { name: "the elephant", similarities: ["re-derived, and nobody asked for this"] },
      { name: "Michael", similarities: ["I also never stop when it matters"] },
    ],
  };
  const exchange = [...EXCHANGE];
  const out = await runConfirm(
    PB, structuredClone(DRAFT), io as never, async () => structuredClone(RECOMPOSED),
    { llm, exchange, upstream: {} },
  );
  assert.deepEqual(out.models[1].similarities, ["I also never stop when it matters"], "the change never landed");
  assert.deepEqual(out.models[0], DRAFT.models[0], "the recomposition spilled onto a model nobody discussed");
  assert.ok(said.includes("Got it."));
});

test("when the recomposition moves nothing, the direct edit gets its turn", async () => {
  const { io } = makeIO(
    [{ action: "feedback", text: "add Michael's similarity" }, { action: "authorize" }],
    ["yes please"],
  );
  const responses = [
    JSON.stringify({ action: "reply", say: "Add what?", directive: "", paths: [] }),
    JSON.stringify({ action: "revise", say: "", directive: "add Michael's similarity", paths: ["models.1"] }),
    // the patch step, reached only because the recomposition came back the same
    JSON.stringify({
      summary: "Added it.", blocked: "",
      ops: [{ op: "add", path: "models.1.similarities.-", value: "He never stops" }],
    }),
  ];
  const llm = { complete: async () => responses.shift() ?? "{}" } as LlmAdapter;
  const out = await runConfirm(
    PB, structuredClone(DRAFT), io as never,
    async () => structuredClone(DRAFT), // recomposes to exactly what was there
    { llm, exchange: [...EXCHANGE], upstream: {} },
  );
  assert.deepEqual(out.models[1].similarities, ["He never stops"]);
});
