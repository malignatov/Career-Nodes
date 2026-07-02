import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaybook } from "./playbook.js";
import { createAdapter } from "./llm.js";
import { runElicit, runInduce, runConfirm, toArtifact, type SessionIO } from "./engine.js";
import type { Artifact } from "./types.js";

const ARTIFACTS_DIR = "artifacts";

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

  console.log(`\n━━━ ${pb.title} ━━━`);
  console.log(`\nWhat happens in this step (shown in full, always):\n${pb.purpose.trim()}`);
  io.note(`(model: ${llm.describe()} — /skip advances a topic, /quit exits)`);

  const upstream: Record<string, unknown> = {};
  for (const dep of pb.consumes) {
    const depPath = join(ARTIFACTS_DIR, `${dep}.json`);
    if (existsSync(depPath)) {
      upstream[dep] = (JSON.parse(readFileSync(depPath, "utf8")) as Artifact).content;
    } else {
      io.note(`(note: upstream artifact "${dep}" not found — continuing without it)`);
    }
  }

  const elicited = await runElicit(pb, llm, io);
  if (elicited.aborted) {
    io.note("(session ended without an artifact)");
    rl.close();
    return;
  }

  io.note("(the conversation is complete — solidifying it into a draft…)");
  const draft = await runInduce(pb, llm, elicited.exchange, upstream, io);
  const authorized = await runConfirm(pb, draft, io, (feedback) =>
    runInduce(pb, llm, elicited.exchange, upstream, io, feedback),
  );

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.json`), JSON.stringify(toArtifact(pb, authorized), null, 2));
  writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.transcript.json`), JSON.stringify(elicited.exchange, null, 2));

  io.say(`Artifact authorized and saved to ${ARTIFACTS_DIR}/${pb.id}.json`);
  if (pb.invalidates.length > 0) {
    io.note(`(in the full app this would mark stale: ${pb.invalidates.join(", ")})`);
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
