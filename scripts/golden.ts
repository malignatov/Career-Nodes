/**
 * Golden-scenario runner: plays the book's case through the REAL engine —
 * scripted client answers into the AI interviewer, inductions, automatic
 * authorization — seeding a dedicated profile the existing UI can display.
 *
 *   npm run golden            # → artifacts/profiles/golden ("Golden · Raymond")
 *   GOLDEN_PROFILE=g2 npm run golden
 *
 * The case data (golden/raymond.json) is built from the owner's copy of the
 * book and is gitignored. Judge the results with: npm run judge
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadPlaybook } from "../src/playbook.ts";
import { createAdapter } from "../src/llm-node.ts";
import { defaultStorage } from "../src/node-storage.ts";
import { scoped } from "../src/storage.ts";
import { runPlaybookSession } from "../src/session.ts";
import type { SessionIO } from "../src/engine.ts";

interface GoldenCase {
  answers: Record<string, string[]>;
}

const CASE = JSON.parse(readFileSync("golden/raymond.json", "utf8")) as GoldenCase;
const PROFILE = process.env.GOLDEN_PROFILE ?? "golden";
if (!/^[a-z0-9-]+$/.test(PROFILE)) throw new Error("bad GOLDEN_PROFILE");

const ORDER = [
  "counseling_goal", "role_models", "favorite_media", "favorite_story", "motto", "early_recollections",
  "perspective", "character_sketch", "preferred_settings", "script", "advice_to_self",
  "life_portrait", "identity_statement", "action_recipe",
];

const root = defaultStorage();
rmSync(join(process.env.CC_ARTIFACTS_DIR ?? "artifacts", "profiles", PROFILE), { recursive: true, force: true });
await root.write(
  `profiles/${PROFILE}/profile.json`,
  JSON.stringify({ name: "Golden · Raymond", created_at: new Date().toISOString() }, null, 2),
);
const store = scoped(root, `profiles/${PROFILE}`);
const llm = createAdapter();
console.log(`golden run via ${llm.describe()} → profiles/${PROFILE}\n`);

for (const id of ORDER) {
  const pb = loadPlaybook(`playbooks/${id}.yaml`);
  const queue = [...(CASE.answers[id] ?? [])];
  let turns = 0;
  const io: SessionIO = {
    say() {},
    note() {},
    // The scripted client: canned answers in order; when they run out, the
    // stage is advanced with /skip, exactly like a client who has said all
    // they have to say.
    ask: async () => {
      turns++;
      return queue.shift() ?? "/skip";
    },
    review: async (payload) =>
      payload.mode === "candidates"
        ? { action: "authorize", value: payload.candidates[0] }
        : { action: "authorize" },
  };
  const t0 = Date.now();
  const outcome = await runPlaybookSession(pb, llm, io, { store, header: false, autoResume: true });
  console.log(`  ${id.padEnd(20)} ${outcome} (${turns} turns, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (outcome !== "authorized") {
    console.error(`  aborting: ${id} did not authorize`);
    process.exit(1);
  }
}
console.log(`\ndone — switch the UI profile to “Golden · Raymond” to browse, then: npm run judge`);
