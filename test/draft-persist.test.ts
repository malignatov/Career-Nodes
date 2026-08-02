/**
 * A death during review must change nothing about what the user reads: the
 * suggested object is persisted the moment it is composed, re-SENT verbatim
 * on reopen, and updated on every revision. Reopening must never recompose —
 * a draft that changes its own words between two sessions reads as betrayal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlaybookSession } from "../src/session.ts";
import { runConfirm } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Playbook } from "../src/types.ts";
import type { Storage } from "../src/storage.ts";

function memStore() {
  const files = new Map<string, string>();
  const writes: { path: string; body: string }[] = [];
  const store = {
    read: async (p: string) => files.get(p) ?? null,
    write: async (p: string, v: string) => { files.set(p, v); writes.push({ path: p, body: v }); },
    exists: async (p: string) => files.has(p),
    remove: async (p: string) => { files.delete(p); },
    list: async () => [...files.keys()],
  } as unknown as Storage;
  return { store, files, writes };
}

const PB = {
  id: "t", version: "0", kind: "conversation", sector: "interview",
  title: "T", purpose: "p", consumes: [], invalidates: [],
  elicit: {
    persona: "warm", guardrails: [],
    stages: [{ id: "s1", goal: "g", opening: "Tell me?", probes: [], done_when: ["told"] }],
  },
  induce: { steps: [{ id: "x", task: "extract", model_tier: "small",
    output_schema: { type: "object", properties: { note: { type: "string" } } } }] },
  confirm: { present: "structured_review", authorize_language: "Keep?" },
} as unknown as Playbook;

const checkerDone = JSON.stringify({
  skip_requested: false, skip_quote: "",
  results: [{ index: 0, satisfied: true, required_count: null,
    entities: [{ name: "a", evidence: "q", satisfied: true }] }],
});

/** Routes by call shape; records what kinds of work the model was asked for. */
function shapedLlm(log: string[], opts: { onInduce?: () => string } = {}): LlmAdapter {
  return {
    complete: async (o: { jsonSchema?: { properties?: Record<string, unknown> } }) => {
      if (o.jsonSchema?.properties?.results) { log.push("checker"); return checkerDone; }
      if (o.jsonSchema) {
        log.push("induce");
        if (opts.onInduce) return opts.onInduce();
        return JSON.stringify({ note: "COMPOSED" });
      }
      log.push("question");
      return "And then?";
    },
  } as unknown as LlmAdapter;
}

test("the draft is persisted the moment it is composed", async () => {
  const { store, writes } = memStore();
  const log: string[] = [];
  let presented: Record<string, unknown> | null = null;
  const io = {
    say: () => {}, sayAnchor: () => {}, note: () => {},
    ask: async () => "my answer",
    review: async (payload: { draft: Record<string, unknown> }) => {
      presented = payload.draft;
      return { action: "authorize" };
    },
  };
  const out = await runPlaybookSession(PB, shapedLlm(log), io as never, { store, header: false, autoResume: true });
  assert.equal(out, "authorized");
  assert.deepEqual(presented, { note: "COMPOSED" });
  const withDraft = writes.filter((w) => w.path === "t.session.json" && w.body.includes('"COMPOSED"'));
  assert.ok(withDraft.length >= 1, "the composed draft must reach the session file before review");
});

test("reopening re-sends the exact object — never a recomposition", async () => {
  const { store } = memStore();
  await store.write("t.session.json", JSON.stringify({
    exchange: [
      { speaker: "interviewer", text: "Tell me?" },
      { speaker: "user", text: "my answer" },
    ],
    stage_index: 1, elicit_done: true,
    draft: { note: "AS THE USER LAST SAW IT" },
  }));
  const log: string[] = [];
  let presented: Record<string, unknown> | null = null;
  const io = {
    say: () => {}, sayAnchor: () => {}, note: () => {},
    ask: async () => { throw new Error("nothing to ask — the interview is over"); },
    review: async (payload: { draft: Record<string, unknown> }) => {
      presented = payload.draft;
      return { action: "authorize" };
    },
  };
  const llm = shapedLlm(log, { onInduce: () => { throw new Error("reopen must not recompose the draft"); } });
  const out = await runPlaybookSession(PB, llm, io as never, { store, header: false, autoResume: true });
  assert.equal(out, "authorized");
  assert.deepEqual(presented, { note: "AS THE USER LAST SAW IT" });
  assert.ok(!log.includes("induce"), `the composer was called on reopen: ${log.join(",")}`);
});

test("every revision updates what a reopen would re-send", async () => {
  const seen: Record<string, unknown>[] = [];
  const reviews = [{ action: "feedback", text: "change the note" }, { action: "authorize" }];
  const asks = ["yes, do it"];
  const io = {
    say: () => {}, note: () => {},
    ask: async () => asks.shift() ?? "",
    review: async () => reviews.shift(),
  };
  const responses = [
    JSON.stringify({ action: "reply", say: "Change it how?", directive: "", paths: [] }),
    JSON.stringify({ action: "revise", say: "", directive: "change the note", paths: [] }),
    JSON.stringify({ summary: "Changed.", blocked: "", ops: [{ op: "set", path: "note", value: "REVISED" }] }),
  ];
  const llm = { complete: async () => responses.shift() ?? "{}" } as LlmAdapter;
  const out = await runConfirm(
    PB, { note: "COMPOSED" }, io as never,
    async () => ({ note: "recomposed — must not be needed" }),
    { llm, exchange: [], upstream: {}, persistDraft: (d) => seen.push(structuredClone(d)) },
  );
  assert.deepEqual(out, { note: "REVISED" });
  assert.deepEqual(seen.at(-1), { note: "REVISED" }, "the revision must be persisted the moment it lands");
});
