/**
 * One call, one reality. A tester's node stuck open while the counselor
 * announced completion: the follow-up used to be generated in parallel with
 * the verdict and never saw it. Now a single response carries the audit AND
 * the next words — the code counts the structured half, the say half is
 * plain language over the same state, and the two can no longer disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runElicit, interviewerSystem } from "../src/engine.ts";
import type { LlmAdapter } from "../src/llm.ts";
import type { Playbook, Stage } from "../src/types.ts";

const PB = {
  id: "t", version: "0", kind: "conversation", sector: "interview",
  title: "T", purpose: "", consumes: [], invalidates: [],
  elicit: {
    persona: "warm", guardrails: [],
    stages: [{
      id: "s1", goal: "three things", opening: "Name three things?",
      probes: [], done_when: ["Each of the three things has been described."],
    }],
  },
} as unknown as Playbook;

const turn = (done: boolean, say: string) => JSON.stringify({
  say, skip_requested: false, skip_quote: "",
  results: [{
    index: 0, satisfied: done, required_count: done ? null : 3,
    entities: done
      ? [{ name: "all", evidence: "q", satisfied: true }]
      : [{ name: "the river", evidence: "q", satisfied: true }, { name: "the mountain", evidence: "", satisfied: false }],
  }],
});

/** Routes by shape: the combined turn's schema carries BOTH results and say. */
function shapedLlm(script: { turns: string[]; plain: string[] }, log: { kind: string; system: string }[]): LlmAdapter {
  return {
    complete: async (o: { system: string; jsonSchema?: { properties?: Record<string, unknown> } }) => {
      const kind = o.jsonSchema?.properties?.say && o.jsonSchema?.properties?.results ? "turn"
        : o.jsonSchema ? "schema" : "plain";
      log.push({ kind, system: o.system });
      return kind === "turn" ? (script.turns.shift() ?? turn(false, "And?")) : (script.plain.shift() ?? "And?");
    },
  } as unknown as LlmAdapter;
}

test("one call per user turn — and its words are the follow-up", async () => {
  const log: { kind: string; system: string }[] = [];
  const answers = ["The river.", "/quit"];
  const said: string[] = [];
  const io = {
    say: (t: string) => said.push(t), sayAnchor: () => {}, note: () => {},
    ask: async () => answers.shift() ?? "/quit",
  };
  await runElicit(PB, shapedLlm({ turns: [turn(false, "What about the mountain?")], plain: [] }, log), io as never, undefined, undefined, {});
  assert.deepEqual(log.map((l) => l.kind), ["turn"], "an answered turn costs exactly one model call");
  assert.deepEqual(said, ["What about the mountain?"], "the say half IS the follow-up");
  const sys = log[0].system;
  assert.match(sys, /interviewer for/, "the combined call keeps the persona");
  assert.match(sys, /audit/i, "…and carries the audit duty");
  assert.match(sys, /Never announce that a topic or the step is complete/, "…and the no-completion-claims rule");
});

test("a done verdict closes the stage silently — no words, no second call", async () => {
  const log: { kind: string; system: string }[] = [];
  const said: string[] = [];
  const io = {
    say: (t: string) => said.push(t), sayAnchor: () => {}, note: () => {},
    ask: async () => "All three, described fully.",
  };
  await runElicit(PB, shapedLlm({ turns: [turn(true, "")], plain: [] }, log), io as never, undefined, undefined, {});
  assert.deepEqual(log.map((l) => l.kind), ["turn"]);
  assert.deepEqual(said, [], "nothing is spoken over a closing stage — the system moves on");
});

test("an audit that returns no words falls back to one plain generation", async () => {
  const log: { kind: string; system: string }[] = [];
  const answers = ["The river.", "/quit"];
  const said: string[] = [];
  const io = {
    say: (t: string) => said.push(t), sayAnchor: () => {}, note: () => {},
    ask: async () => answers.shift() ?? "/quit",
  };
  await runElicit(PB, shapedLlm({ turns: [turn(false, "")], plain: ["Go on?"] }, log), io as never, undefined, undefined, {});
  assert.deepEqual(log.map((l) => l.kind), ["turn", "plain"], "empty say → one plain fallback, never a stall");
  assert.deepEqual(said, ["Go on?"]);
});

test("the raw JSON never lands in the record", async () => {
  const answers = ["The river.", "/quit"];
  const io = {
    say: () => {}, sayAnchor: () => {}, note: () => {},
    ask: async () => answers.shift() ?? "/quit",
  };
  const out = await runElicit(PB, shapedLlm({ turns: [turn(false, "What about the mountain?")], plain: [] }, []), io as never, undefined, undefined, {});
  const record = JSON.stringify(out.exchange);
  assert.ok(!record.includes("skip_requested") && !record.includes("required_count"),
    "only the say half may reach the transcript");
});

test("the system prompt forbids announcing completion", () => {
  const sys = interviewerSystem(PB, PB.elicit!.stages[0] as Stage);
  assert.match(sys, /Never announce that a topic or the step is complete/);
});
