/**
 * distill() — the artifact → journey-card summaries — and
 * reconstructManualAnswers — hand-recorded transcripts staying editable,
 * amend turns excluded. Pure functions, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { distill } from "../src/journey.ts";
import { reconstructManualAnswers } from "../src/manual.ts";
import type { ExchangeEntry, Playbook } from "../src/types.ts";

test("distill: role models join names in order", () => {
  const parts = distill("role_models", { models: [{ name: "Lincoln" }, { name: "Edison" }, {}] });
  assert.deepEqual(parts, [{ label: null, text: "Lincoln · Edison" }]);
});

test("distill: recollection headlines quoted, empty ones dropped", () => {
  const parts = distill("early_recollections", {
    recollections: [{ headline: "Boy Rides On" }, { headline: null }, { headline: "Race Lost, Hearts Won" }],
  });
  assert.deepEqual(parts, [{ label: null, text: "“Boy Rides On” · “Race Lost, Hearts Won”" }]);
});

test("distill: life portrait prefers movements, falls back to full text", () => {
  const movements = distill("life_portrait", {
    movements: [{ title: "Self", text: "You are…" }, { title: "Empty", text: " " }],
    full_portrait: "fallback",
  });
  assert.deepEqual(movements, [{ label: "Self", text: "You are…" }]);
  const fallback = distill("life_portrait", { movements: [], full_portrait: "fallback" });
  assert.deepEqual(fallback, [{ label: null, text: "fallback" }]);
});

test("distill: identity statement is the single line", () => {
  assert.deepEqual(distill("identity_statement", { statement: "I will be happy when…" }),
    [{ label: null, text: "I will be happy when…" }]);
});

const PB = {
  elicit: {
    stages: [
      { id: "s1", opening: "First question?", opening_i18n: { ru: "Первый вопрос?" } },
      { id: "s2", opening: "Second question?" },
    ],
  },
} as unknown as Playbook;

test("manual reconstruction maps anchor questions to concatenated answers", () => {
  const ex: ExchangeEntry[] = [
    { speaker: "interviewer", text: "First question?" },
    { speaker: "user", text: "answer one" },
    { speaker: "user", text: "more of answer one" },
    { speaker: "interviewer", text: "Second question?" },
    { speaker: "user", text: "answer two" },
  ];
  assert.deepEqual(reconstructManualAnswers(PB, ex), {
    s1: "answer one\nmore of answer one",
    s2: "answer two",
  });
});

test("manual reconstruction accepts localized anchors and rejects free-form interviews", () => {
  const ru: ExchangeEntry[] = [
    { speaker: "interviewer", text: "Первый вопрос?" },
    { speaker: "user", text: "ответ" },
  ];
  assert.deepEqual(reconstructManualAnswers(PB, ru), { s1: "ответ" });
  const ai: ExchangeEntry[] = [
    { speaker: "interviewer", text: "A freely-worded AI follow-up" },
    { speaker: "user", text: "answer" },
  ];
  assert.equal(reconstructManualAnswers(PB, ai), null);
});

test("manual reconstruction skips amend turns — an amended artifact stays editable", () => {
  const ex: ExchangeEntry[] = [
    { speaker: "interviewer", text: "First question?" },
    { speaker: "user", text: "answer one" },
    { speaker: "user", text: "please soften the draft", phase: "amend" },
    { speaker: "interviewer", text: "Softened — anything else?", phase: "amend" },
  ];
  assert.deepEqual(reconstructManualAnswers(PB, ex), { s1: "answer one" });
});
