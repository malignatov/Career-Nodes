/**
 * The stage-done checker's code side: the model enumerates, the CODE counts.
 * A fake adapter returns scripted checker JSON — no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkerItemOk, checkStageDone } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Stage } from "../src/types.ts";

const item = (over: Record<string, unknown>) => ({
  index: 0, satisfied: true, required_count: null, entities: [], ...over,
}) as Parameters<typeof checkerItemOk>[0];

test("required_count: satisfied entities must reach the count", () => {
  const ents = (n: number, sat: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `m${i}`, evidence: "q", satisfied: i < sat }));
  assert.equal(checkerItemOk(item({ required_count: 3, entities: ents(3, 3) })), true);
  assert.equal(checkerItemOk(item({ required_count: 3, entities: ents(3, 2) })), false);
  assert.equal(checkerItemOk(item({ required_count: 3, entities: ents(2, 2) })), false); // two named ≠ three
  // the model's own top-level verdict cannot override the arithmetic
  assert.equal(checkerItemOk(item({ satisfied: true, required_count: 3, entities: ents(2, 2) })), false);
});

test("entity list without a count: every entity must pass AND the item verdict holds", () => {
  const ents = [{ name: "a", evidence: "q", satisfied: true }, { name: "b", evidence: "q", satisfied: false }];
  assert.equal(checkerItemOk(item({ entities: ents })), false);
  assert.equal(checkerItemOk(item({ entities: [ents[0]] })), true);
  assert.equal(checkerItemOk(item({ entities: [ents[0]], satisfied: false })), false);
});

test("unquantified item falls back to the model verdict", () => {
  assert.equal(checkerItemOk(item({ satisfied: true })), true);
  assert.equal(checkerItemOk(item({ satisfied: false })), false);
});

const STAGE: Stage = {
  id: "compare",
  goal: "g",
  opening: "o",
  done_when: ["A similarity for each model.", "The user confirmed."],
} as Stage;

const fakeLlm = (raw: string): LlmAdapter => ({ complete: async () => raw }) as LlmAdapter;

test("checkStageDone: every checklist item must be covered — a short answer fails", async () => {
  const oneItem = JSON.stringify({ results: [
    { index: 0, satisfied: true, required_count: null, entities: [] },
  ] });
  assert.equal((await checkStageDone(fakeLlm(oneItem), STAGE, [])).done, false);

  const both = JSON.stringify({ results: [
    { index: 0, satisfied: true, required_count: null, entities: [] },
    { index: 1, satisfied: true, required_count: null, entities: [] },
  ] });
  assert.equal((await checkStageDone(fakeLlm(both), STAGE, [])).done, true);
});

test("checkStageDone: malformed model output fails closed", async () => {
  assert.deepEqual(await checkStageDone(fakeLlm("not json at all"), STAGE, []), { done: false, skip: false, evidence: false, results: [] });
});
