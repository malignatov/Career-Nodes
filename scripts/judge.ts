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
import { loadPlaybook } from "../src/playbook.ts";
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

interface Scored {
  label: string;
  score: number;
  counts: { pass: number; partial: number; fail: number };
  j: Judgement;
}

for (const [id, spec] of Object.entries(CASE.gold)) {
  const raw = await store.read(`${id}.json`);
  if (raw === null) {
    table.push(`| ${id} | — | missing artifact |`);
    continue;
  }
  const art = JSON.parse(raw) as Artifact;

  // Candidates-mode nodes: judge each candidate; a real user picks, so the
  // engine's quality is the BEST candidate, not the arbitrary first.
  const pb = loadPlaybook(`playbooks/${id}.yaml`);
  const field = pb.confirm?.present === "candidates" ? pb.confirm.choice_field : undefined;
  let variants: { label: string; content: Record<string, unknown> }[] = [
    { label: "artifact", content: art.content },
  ];
  if (field) {
    const candsRaw = await store.read(`${id}.candidates.json`);
    if (candsRaw !== null) {
      const cands = JSON.parse(candsRaw) as string[];
      variants = cands.map((c, i) => ({
        label: `candidate ${i + 1}${art.content[field] === c ? " (auto-picked)" : ""}`,
        content: { ...art.content, [field]: c },
      }));
    }
  }

  const scored: Scored[] = [];
  for (const variant of variants) {
    const response = await judgeOne(spec, id, variant.content);
    const counts = { pass: 0, partial: 0, fail: 0 };
    for (const v of response.verdicts) counts[v.verdict]++;
    const score = response.verdicts.length
      ? Math.round(((counts.pass + counts.partial * 0.5) / response.verdicts.length) * 10) : 0;
    scored.push({ label: variant.label, score, counts, j: response });
  }
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const suffix = scored.length > 1 ? ` (best of ${scored.length})` : "";
  table.push(`| ${id} | ${best.score}/10${suffix} | ${best.counts.pass}✓ ${best.counts.partial}± ${best.counts.fail}✗ |`);
  lines.push(`## ${id} — ${best.score}/10${suffix ? ` — ${best.label}${suffix}` : ""}`, "", best.j.summary, "");
  if (scored.length > 1) {
    for (const v of scored) lines.push(`- ${v.label}: ${v.score}/10`);
    lines.push("");
  }
  for (const v of best.j.verdicts) {
    const mark = v.verdict === "pass" ? "✓" : v.verdict === "partial" ? "±" : "✗";
    lines.push(`- ${mark} ${v.criterion}`, `  - ${v.evidence}`);
  }
  lines.push("");
  console.log(`${id.padEnd(20)} ${String(best.score).padStart(2)}/10${suffix.padEnd(12)}  ${best.counts.pass}✓ ${best.counts.partial}± ${best.counts.fail}✗`);
}

async function judgeOne(spec: GoldSpec, id: string, content: Record<string, unknown>): Promise<Judgement> {
  const response = await llm.complete({
    tier: "large",
    system: SYSTEM,
    temperature: 0,
    maxTokens: 2000,
    jsonSchema: SCHEMA,
    messages: [{
      role: "user",
      content:
        `Case node: ${id}\n\nGold assessment (what the book's author concluded):\n${spec.summary}\n\n` +
        `Criteria:\n${spec.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n` +
        `Engine artifact (JSON):\n${JSON.stringify(content, null, 2)}`,
    }],
  });
  return JSON.parse(response.replace(/^```(json)?\n?|\n?```$/g, "")) as Judgement;
}

lines.splice(5, 0, "| node | score | criteria |", "|---|---|---|", ...table, "");
const out = `golden/report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
writeFileSync(out, lines.join("\n"));
console.log(`\nreport: ${out}`);
