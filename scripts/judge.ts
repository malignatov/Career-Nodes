/**
 * LLM-as-judge for the golden scenario: scores each engine artifact against
 * criteria distilled from the book's own worked assessment of the case.
 *
 *   npm run judge                          # judge = the configured large tier
 *   JUDGE_MODEL=z-ai/some-model npm run judge   # independent judge (recommended)
 *
 * Writes golden/report-<timestamp>.md and prints a summary table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createAdapter } from "../src/llm-node.ts";
import { defaultStorage } from "../src/node-storage.ts";
import { scoped } from "../src/storage.ts";
import type { Artifact } from "../src/types.ts";

interface GoldSpec {
  summary: string;
  criteria: string[];
}
interface GoldenCase {
  gold: Record<string, GoldSpec>;
}
interface Verdict {
  criterion: string;
  verdict: "pass" | "partial" | "fail";
  evidence: string;
}
interface Judgement {
  verdicts: Verdict[];
  summary: string;
}

const CASE = JSON.parse(readFileSync("golden/raymond.json", "utf8")) as GoldenCase;
const PROFILE = process.env.GOLDEN_PROFILE ?? "golden";

const judgeModel = process.env.JUDGE_MODEL;
if (judgeModel) {
  // The config seam lets us swap the large tier for an independent judge.
  (globalThis as { CC_CONFIG?: Record<string, string> }).CC_CONFIG = { LLM_LARGE_MODEL: judgeModel };
}
const llm = createAdapter();
const store = scoped(defaultStorage(), `profiles/${PROFILE}`);

const SYSTEM =
  "You are grading the output of a career-counseling engine against the published gold assessment of the same case. " +
  "Judge only what the artifact actually says. Be strict: 'pass' requires the criterion to be clearly satisfied, " +
  "'partial' means gestured at but incomplete, 'fail' means absent or contradicted. Return JSON only.";

const SCHEMA = {
  type: "object",
  required: ["verdicts", "summary"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["criterion", "verdict", "evidence"],
        properties: {
          criterion: { type: "string" },
          verdict: { type: "string", enum: ["pass", "partial", "fail"] },
          evidence: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
  },
};

const lines: string[] = [
  `# Golden judge report — profile “${PROFILE}”`,
  "",
  `- date: ${new Date().toISOString()}`,
  `- judge: ${llm.describe()}${judgeModel ? "" : "  ⚠ same model family as the engine — prefer JUDGE_MODEL=<independent model>"}`,
  "",
];
const table: string[] = [];

for (const [id, spec] of Object.entries(CASE.gold)) {
  const raw = await store.read(`${id}.json`);
  if (raw === null) {
    table.push(`| ${id} | — | missing artifact |`);
    continue;
  }
  const art = JSON.parse(raw) as Artifact;
  const response = await llm.complete({
    tier: "large",
    system: SYSTEM,
    maxTokens: 2000,
    jsonSchema: SCHEMA,
    messages: [{
      role: "user",
      content:
        `Case node: ${id}\n\nGold assessment (what the book's author concluded):\n${spec.summary}\n\n` +
        `Criteria:\n${spec.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
        `Engine artifact (JSON):\n${JSON.stringify(art.content, null, 2)}`,
    }],
  });
  const j = JSON.parse(response.replace(/^```(json)?\n?|\n?```$/g, "")) as Judgement;
  const counts = { pass: 0, partial: 0, fail: 0 };
  for (const v of j.verdicts) counts[v.verdict]++;
  // Deterministic score: models are unreliable graders of their own rubric math.
  const score = j.verdicts.length ? Math.round(((counts.pass + counts.partial * 0.5) / j.verdicts.length) * 10) : 0;
  table.push(`| ${id} | ${score}/10 | ${counts.pass}✓ ${counts.partial}± ${counts.fail}✗ |`);
  lines.push(`## ${id} — ${score}/10`, "", j.summary, "");
  for (const v of j.verdicts) {
    const mark = v.verdict === "pass" ? "✓" : v.verdict === "partial" ? "±" : "✗";
    lines.push(`- ${mark} ${v.criterion}`, `  - ${v.evidence}`);
  }
  lines.push("");
  console.log(`${id.padEnd(20)} ${String(score).padStart(2)}/10  ${counts.pass}✓ ${counts.partial}± ${counts.fail}✗`);
}

lines.splice(5, 0, "| node | score | criteria |", "|---|---|---|", ...table, "");
const out = `golden/report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\nreport: ${out}`);
