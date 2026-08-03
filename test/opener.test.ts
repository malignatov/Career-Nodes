/**
 * The baked opener composes greeting → preamble → anchor, deterministically.
 * The preamble is client-facing framing only: it must never leak into
 * stageOpening (which feeds interviewer prompts and the practitioner script
 * view), and a playbook without one keeps the two-part opener.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runElicit, stageOpening, stagePreamble } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Playbook } from "../src/types.ts";

const llmNever: LlmAdapter = {
  complete: async () => { throw new Error("the baked opener must not call the model"); },
} as LlmAdapter;

function goalLike(stage0Extra: Record<string, unknown>): Playbook {
  return {
    id: "goal", version: "0", kind: "conversation", sector: "goal",
    title: "Goal", purpose: "", consumes: [], invalidates: [],
    elicit: {
      persona: "warm", guardrails: [],
      stages: [{
        id: "open", goal: "the request",
        opening: "How can this process be useful to you?",
        opening_i18n: { ru: "Чем этот процесс может быть полезен тебе?" },
        probes: [], done_when: ["a request"],
        ...stage0Extra,
      }],
    },
    induce: { steps: [] },
    confirm: { present: "structured_review", authorize_language: "Keep it" },
  } as unknown as Playbook;
}

const PRE = {
  opening_preamble: "There are no right or wrong answers here.",
  opening_preamble_i18n: { ru: "Здесь нет правильных и неправильных ответов." },
};

async function bakedOpener(pb: Playbook, lang?: { code: string; instruction: string }) {
  let opener = "";
  const io = {
    sayAnchor: (t: string) => { opener = t; },
    say: () => {}, note: () => {},
    ask: async () => "/quit",
  };
  await runElicit(pb, llmNever, io as never, undefined, lang);
  return opener;
}

test("preamble lands between greeting and anchor, in both languages", async () => {
  const en = await bakedOpener(goalLike(PRE));
  const [greetEn, preEn, anchorEn] = en.split("\n\n");
  assert.match(greetEn, /glad you're here/);
  assert.equal(preEn, PRE.opening_preamble);
  assert.equal(anchorEn, "How can this process be useful to you?");

  const ru = await bakedOpener(goalLike(PRE), { code: "ru", instruction: "Russian" });
  const [, preRu, anchorRu] = ru.split("\n\n");
  assert.equal(preRu, PRE.opening_preamble_i18n.ru);
  assert.equal(anchorRu, "Чем этот процесс может быть полезен тебе?");
});

test("a playbook without a preamble keeps the two-part opener", async () => {
  const en = await bakedOpener(goalLike({}));
  assert.equal(en.split("\n\n").length, 2, `opener grew a phantom part: ${en}`);
});

test("the preamble never leaks into the anchor", () => {
  const stage = goalLike(PRE).elicit!.stages[0];
  assert.ok(!stageOpening(stage).includes("wrong answers"), "stageOpening must stay the pure anchor");
  assert.ok(!stageOpening(stage, { code: "ru", instruction: "r" } as never).includes("неправильных"));
  assert.equal(stagePreamble(goalLike({}).elicit!.stages[0]), undefined, "absent preamble is undefined, not empty string");
});
