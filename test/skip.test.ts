/**
 * Graceful skip: a /skip before anything is shared must end the whole
 * interview, produce a schema-shaped empty draft, review it with skip
 * language, and close the node as authorized (origin "skipped").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runElicit, runConfirm, skipContent } from "../src/engine.ts";
import { runPlaybookSession } from "../src/session.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Artifact, Playbook } from "../src/types.ts";
import type { Storage } from "../src/storage.ts";

const ER = {
  id: "er", version: "0", kind: "conversation", sector: "interview",
  title: "Early recollections", purpose: "", consumes: [], invalidates: [],
  elicit: {
    persona: "warm", guardrails: [],
    stages: [
      { id: "stories", goal: "three memories", opening: "Tell me a memory.", probes: [], done_when: ["three told"] },
      { id: "headlines", goal: "headlines", opening: "Headline it.", probes: [], done_when: ["done"] },
    ],
  },
  induce: { steps: [] },
  confirm: { present: "structured_review", authorize_language: "Authorize?" },
  artifact: {
    schema: {
      type: "object",
      required: ["recollections", "summary"],
      properties: { recollections: { type: "array" }, summary: { type: "string" } },
    },
  },
} as unknown as Playbook;

const llmNever: LlmAdapter = {
  complete: async () => { throw new Error("the skip path must not call the model"); },
} as LlmAdapter;

function memStore(): { store: Storage; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    store: {
      read: async (p: string) => files.get(p) ?? null,
      write: async (p: string, v: string) => { files.set(p, v); },
      exists: async (p: string) => files.has(p),
      remove: async (p: string) => { files.delete(p); },
      list: async () => [...files.keys()],
    } as unknown as Storage,
  };
}

test("skipContent shapes every required field, empty and honest", () => {
  assert.deepEqual(skipContent(ER), { recollections: [], summary: "" });
});

test("a /skip with nothing shared ends the whole interview as skipped", async () => {
  const noted: string[] = [];
  const io = {
    say: () => {}, note: (t: string) => noted.push(t),
    ask: async () => "/skip",
  };
  const out = await runElicit(ER, llmNever, io as never);
  assert.equal(out.aborted, false);
  assert.equal(out.skipped, true);
  assert.ok(noted.some((n) => n.includes("skipped")), "skip must be narrated");
});

test("a spoken skip ('let's skip') is honored via the checker, not just /skip", async () => {
  const noted: string[] = [];
  const asks = ["Let's skip"];
  const io = {
    say: () => {}, note: (t: string) => noted.push(t),
    ask: async () => asks.shift() ?? "/quit",
  };
  // Promise.all order: the checker's complete() fires first, the speculative
  // follow-up second — both scripted.
  const llm = {
    complete: async () =>
      JSON.stringify({
        results: [{ index: 0, satisfied: false, required_count: null, entities: [] }],
        skip_requested: true,
        skip_quote: "Let's skip",
      }),
  } as unknown as LlmAdapter;
  const out = await runElicit(ER, llm, io as never);
  assert.equal(out.skipped, true, "spoken skip with nothing shared must close the step");
  assert.ok(out.exchange.some((e) => e.speaker === "user" && e.text === "Let's skip"), "the user's words stay in the record");
});

test("'skip' quoted INSIDE a memory is content, not a request (quote gate)", async () => {
  const memory = "I was hoping for the BD party, but my mama said 'let's skip it'";
  const asks = [memory, "/quit"];
  const io = { say: () => {}, note: () => {}, ask: async () => asks.shift() ?? "/quit" };
  // A misfiring checker: skip_requested true but the citation is only the
  // fragment inside the user's story — the gate must reject it.
  const llm = {
    complete: async () =>
      JSON.stringify({
        results: [{ index: 0, satisfied: false, required_count: null, entities: [] }],
        skip_requested: true,
        skip_quote: "let's skip it",
      }),
  } as unknown as LlmAdapter;
  const out = await runElicit(ER, llm, io as never);
  assert.equal(out.aborted, true, "the interview must continue (user then quit), never auto-skip");
  assert.ok(out.exchange.some((e) => e.text === memory), "the memory stays in the record");
});

test("skipMode review carries the skip language and plain-fields mode", async () => {
  let seen: { authorize_language?: string; mode?: string } = {};
  const io = {
    say: () => {}, note: () => {},
    ask: async () => "",
    review: async (p: { authorize_language: string; mode: string }) => { seen = p; return { action: "authorize" }; },
  };
  const empty = skipContent(ER);
  const out = await runConfirm(ER, empty, io as never, async () => empty, { skipMode: true });
  assert.equal(seen.authorize_language, "Skip this step");
  assert.equal(seen.mode, "structured_review");
  assert.deepEqual(out, empty);
});

test("full session: skip → empty artifact saved with origin skipped, session file removed", async () => {
  const { store, files } = memStore();
  const io = {
    say: () => {}, note: () => {},
    ask: async () => "/skip",
    review: async () => ({ action: "authorize" }),
  };
  const outcome = await runPlaybookSession(ER, llmNever, io as never, { store, autoResume: true });
  assert.equal(outcome, "authorized");
  const art = JSON.parse(files.get("er.json") ?? "{}") as Artifact;
  assert.equal(art.origin, "skipped");
  assert.deepEqual(art.content, { recollections: [], summary: "" });
  assert.ok(!files.has("er.session.json"), "session file must be cleaned up");
});
