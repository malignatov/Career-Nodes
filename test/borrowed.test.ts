/**
 * A comparison the client made about one role model must not appear under
 * another. The composer sometimes fills a thin third entry with material it
 * already has; every word is the client's, so the verbatim pass sees nothing
 * wrong. The code catches it and the review calls it assumed.
 *
 * End to end through the real induce path, with a scripted adapter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInduce } from "../src/engine.ts";
import { loadPlaybook } from "../src/playbook.ts";
import type { LlmAdapter } from "../src/llm.ts";

const scripted = (payload: unknown): LlmAdapter =>
  ({ complete: async () => JSON.stringify(payload) }) as unknown as LlmAdapter;

const io = { say: () => {}, note: () => {}, ask: async () => "" } as never;

const exchange = [
  { speaker: "user", text: "The elephant. I see what is possible where others see a wall." },
  { speaker: "user", text: "My grandmother. She was patient." },
  { speaker: "user", text: "Michael. He never stops." },
] as never[];

test("a comparison lifted onto a second model comes back flagged", async () => {
  const pb = loadPlaybook("playbooks/role_models.yaml");
  const draft = await runInduce(
    pb,
    scripted({
      models: [
        { name: "the elephant", similarities: ["I see what is possible"], differences: [] },
        { name: "my grandmother", similarities: [], differences: [] },
        // lifted from the elephant — the client never said this of Michael
        { name: "Michael", similarities: ["I see what is possible"], differences: [] },
      ],
    }),
    exchange,
    {},
    io,
  );
  assert.deepEqual(draft._verbatim_warnings, ["I see what is possible"]);
});

test("comparisons the client actually made about each model pass clean", async () => {
  const pb = loadPlaybook("playbooks/role_models.yaml");
  const draft = await runInduce(
    pb,
    scripted({
      models: [
        { name: "the elephant", similarities: ["I see what is possible"], differences: [] },
        { name: "my grandmother", similarities: [], differences: [] },
        { name: "Michael", similarities: ["He never stops"], differences: [] },
      ],
    }),
    exchange,
    {},
    io,
  );
  assert.equal(draft._verbatim_warnings, undefined);
});
