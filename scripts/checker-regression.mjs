// Regression test for the per-entity stage-done checker, using REAL saved
// transcripts (run from the repo root; needs the .env model key):
//   node --env-file=.env scripts/checker-regression.mjs
//
// - The default-profile role_models run (the observed 2026-07-20 failure:
//   two models collected, only one compared) must NOT pass its gates.
// - The golden Raymond run (all three compared, partly collectively via
//   "I am like them…") must pass — strictness must not overcorrect.
import { readFileSync } from "node:fs";
import { checkStageDone } from "../src/engine.ts";
import { createAdapter } from "../src/llm-node.ts";
import { PLAYBOOKS } from "../src/playbooks-data.ts";

const llm = createAdapter();
const stages = PLAYBOOKS.role_models.elicit.stages;
const collect = stages.find((s) => s.id === "collect");
const compare = stages.find((s) => s.id === "compare");

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const mikhail = load("artifacts/role_models.transcript.json");
const golden = load("artifacts/profiles/golden/role_models.transcript.json");

const cases = [
  ["mikhail/collect (2 models)        expect NOT done", collect, mikhail, false],
  ["mikhail/compare (1 of 2 compared) expect NOT done", compare, mikhail, false],
  ["golden/compare  (all compared)    expect done", compare, golden, true],
];

let fail = 0;
for (const [label, stage, exchange, expect] of cases) {
  const got = (await checkStageDone(llm, stage, exchange)).done;
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${got}`);
}
process.exit(fail ? 1 : 0);
