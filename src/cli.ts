import { createInterface } from "node:readline/promises";
import { loadPlaybook } from "./playbook.ts";
import { createAdapter } from "./llm-node.ts";
import { defaultStorage } from "./node-storage.ts";
import { runPlaybookSession } from "./session.ts";
import type { SessionIO } from "./engine.ts";

async function main(): Promise<void> {
  const path = process.argv[2] ?? "playbooks/counseling_goal.yaml";
  const pb = loadPlaybook(path);
  const llm = createAdapter();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const io: SessionIO = {
    say: (t) => console.log(`\n${t}`),
    note: (t) => console.log(`\x1b[2m${t}\x1b[0m`),
    ask: async (prompt) => rl.question(`\n${prompt} > `),
  };

  io.note(`(model: ${llm.describe()} — /skip advances a topic, /quit exits)`);
  await runPlaybookSession(pb, llm, io, { store: defaultStorage() });
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
