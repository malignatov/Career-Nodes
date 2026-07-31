/**
 * With the provider pinned (LLM_ALLOW_PROVIDERS=DeepInfra) there is no
 * fallback routing — a 429 burst must be ridden out by the adapter, not
 * surfaced into the middle of an interview. Fetch is stubbed; time is faked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatAdapter } from "../src/llm.ts";

const ok = (content: string) =>
  ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;
const status = (code: number) =>
  ({ ok: false, status: code, text: async () => `err ${code}` }) as unknown as Response;

function withFetch(responses: Response[], calls: { n: number }) {
  globalThis.fetch = (async () => {
    calls.n++;
    return responses.shift() ?? status(500);
  }) as typeof fetch;
}

process.env.LLM_PROVIDER = "openrouter";
process.env.LLM_API_KEY = "test-key-not-real";
process.env.LLM_RETRY_MS = "1,1,1"; // real timers, instant backoff

test("a 429 burst is retried with backoff and the call succeeds", async () => {
  const realFetch = globalThis.fetch;
  const calls = { n: 0 };
  withFetch([status(429), status(429), ok("ready")], calls);
  try {
    const out = await new OpenAICompatAdapter("openrouter").complete({
      tier: "small", system: "s", messages: [{ role: "user", content: "u" }],
    });
    assert.equal(out, "ready");
    assert.equal(calls.n, 3, "two bursts, two backoffs, then the answer");
  } finally { globalThis.fetch = realFetch; }
});

test("a non-retriable status still fails fast", async () => {
  const realFetch = globalThis.fetch;
  const calls = { n: 0 };
  withFetch([status(401)], calls);
  try {
    await assert.rejects(
      new OpenAICompatAdapter("openrouter").complete({
        tier: "small", system: "s", messages: [{ role: "user", content: "u" }],
      }),
      /401/,
    );
    assert.equal(calls.n, 1, "auth errors must not be retried");
  } finally { globalThis.fetch = realFetch; }
});

test("a sustained outage exhausts the retries and reports the last status", async () => {
  const realFetch = globalThis.fetch;
  const calls = { n: 0 };
  withFetch([status(429), status(429), status(429), status(429), status(429)], calls);
  try {
    await assert.rejects(
      new OpenAICompatAdapter("openrouter").complete({
        tier: "small", system: "s", messages: [{ role: "user", content: "u" }],
      }),
      /429/,
    );
    assert.equal(calls.n, 4, "three backoffs → four attempts, then the truth");
  } finally { globalThis.fetch = realFetch; }
});
