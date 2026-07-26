/**
 * distill() — the artifact → journey-card summaries — and
 * reconstructManualAnswers — hand-recorded transcripts staying editable,
 * amend turns excluded. Pure functions, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { distill, nodeStatus } from "../src/journey.ts";
import { reconstructManualAnswers } from "../src/manual.ts";
import type { ExchangeEntry, Playbook } from "../src/types.ts";
import type { Storage } from "../src/storage.ts";

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

/* ── the interview is never locked ───────────────────────── */

const emptyStore = () => ({
  read: async () => null,
  write: async () => {},
  exists: async () => false,      // nothing authorized yet: a virgin journey
  remove: async () => {},
  list: async () => [],
} as unknown as Storage);

const pb = (id: string, kind: string, sector: string, consumes: string[]): Playbook =>
  ({ id, kind, sector, consumes, invalidates: [], version: "0", title: id, purpose: "" }) as unknown as Playbook;

const BOOK: Record<string, Playbook> = {
  counseling_goal: pb("counseling_goal", "conversation", "goal", []),
  role_models: pb("role_models", "conversation", "interview", ["counseling_goal"]),
  motto: pb("motto", "conversation", "interview", ["counseling_goal"]),
  perspective: pb("perspective", "derived", "induction", ["early_recollections", "counseling_goal"]),
  closing_check: pb("closing_check", "conversation", "action", ["counseling_goal", "motto"]),
};

test("nodeStatus: any interview question opens before the goal is authorized", async () => {
  const store = emptyStore();
  const look = (id: string) => BOOK[id] ?? null;
  // A client who arrives wanting to talk about their heroes is not turned away.
  assert.equal(await nodeStatus("role_models", store, look), "available");
  assert.equal(await nodeStatus("motto", store, look), "available");
  assert.equal(await nodeStatus("counseling_goal", store, look), "available");
});

test("nodeStatus: derived steps and the closing check still wait for their sources", async () => {
  const store = emptyStore();
  const look = (id: string) => BOOK[id] ?? null;
  // These compose from, or read back, words that do not exist yet.
  assert.equal(await nodeStatus("perspective", store, look), "planned");
  assert.equal(await nodeStatus("closing_check", store, look), "planned");
});

/* ── starting a step over ────────────────────────────────── */

/** A store backed by a plain map of filename → contents. */
const mapStore = (files: Record<string, string>) => ({
  read: async (p: string) => files[p] ?? null,
  write: async (p: string, v: string) => { files[p] = v; },
  exists: async (p: string) => p in files,
  remove: async (p: string) => { delete files[p]; },
  list: async () => Object.keys(files),
} as unknown as Storage);

const artifact = (at: string) => JSON.stringify({ authorized_at: at, content: {} });

test("nodeStatus: a derived step whose source was started over is no longer settled", async () => {
  const look = (id: string) => BOOK[id] ?? null;
  const files: Record<string, string> = {
    "early_recollections.json": artifact("2026-01-01T00:00:00.000Z"),
    "perspective.json": artifact("2026-01-02T00:00:00.000Z"),
  };
  const store = mapStore(files);
  assert.equal(await nodeStatus("perspective", store, look), "authorized");

  // The client starts the recollections over. What was composed from them is
  // not merely out of date — it is standing on nothing they approved.
  delete files["early_recollections.json"];
  assert.equal(await nodeStatus("perspective", store, look), "stale");
});

test("nodeStatus: the goal is context, so starting IT over unsettles nothing downstream", async () => {
  const look = (id: string) => BOOK[id] ?? null;
  const files: Record<string, string> = {
    "early_recollections.json": artifact("2026-01-01T00:00:00.000Z"),
    "perspective.json": artifact("2026-01-02T00:00:00.000Z"),
    "counseling_goal.json": artifact("2026-01-01T00:00:00.000Z"),
  };
  const store = mapStore(files);
  delete files["counseling_goal.json"];
  assert.equal(await nodeStatus("perspective", store, look), "authorized");
});

test("nodeStatus: a step started over reads as untouched again", async () => {
  const look = (id: string) => BOOK[id] ?? null;
  const files: Record<string, string> = {
    "role_models.json": artifact("2026-01-01T00:00:00.000Z"),
    "role_models.transcript.json": "[]",
  };
  const store = mapStore(files);
  assert.equal(await nodeStatus("role_models", store, look), "authorized");
  // Reset removes every file the step owns — artifact, draft, session, record.
  for (const suffix of [".json", ".session.json", ".draft.json", ".transcript.json"]) {
    delete files[`role_models${suffix}`];
  }
  assert.equal(await nodeStatus("role_models", store, look), "available");
});
