import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlaybook } from "./playbook.ts";
import { createAdapter } from "./llm.ts";
import { runElicit, runInduce, runConfirm, toArtifact, type SessionIO } from "./engine.ts";
import type { Artifact, ExchangeEntry } from "./types.ts";

const ARTIFACTS_DIR = "artifacts";

interface SessionState {
  exchange: ExchangeEntry[];
  stage_index: number;
  elicit_done?: boolean;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? "playbooks/counseling_goal.yaml";
  const pb = loadPlaybook(path);
  const llm = createAdapter();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const sessionPath = join(ARTIFACTS_DIR, `${pb.id}.session.json`);

  const io: SessionIO = {
    say: (t) => console.log(`\n${t}`),
    note: (t) => console.log(`\x1b[2m${t}\x1b[0m`),
    ask: async (prompt) => rl.question(`\n${prompt} > `),
    onTurn: (exchange, stageIndex) =>
      writeFileSync(
        sessionPath,
        JSON.stringify({ exchange, stage_index: stageIndex } satisfies SessionState, null, 2),
      ),
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

  let exchange: ExchangeEntry[] = [];

  if (pb.elicit) {
    let resume: SessionState | undefined;
    if (existsSync(sessionPath)) {
      const saved = JSON.parse(readFileSync(sessionPath, "utf8")) as SessionState;
      if (saved.exchange.length > 0) {
        const answer = (
          await io.ask(`a saved conversation (${saved.exchange.length} entries) exists — (r)esume it or (s)tart over`)
        ).trim().toLowerCase();
        if (answer.startsWith("r")) resume = saved;
      }
    }

    if (resume?.elicit_done) {
      exchange = resume.exchange;
      io.note("(the interview was already complete — moving straight to drafting)");
    } else {
      const elicited = await runElicit(
        pb, llm, io,
        resume ? { exchange: resume.exchange, stageIndex: resume.stage_index } : undefined,
      );
      if (elicited.aborted) {
        io.note("(no artifact yet — your progress is saved; run this playbook again to resume)");
        rl.close();
        return;
      }
      exchange = elicited.exchange;
      writeFileSync(
        sessionPath,
        JSON.stringify(
          { exchange, stage_index: pb.elicit.stages.length, elicit_done: true } satisfies SessionState,
          null, 2,
        ),
      );
      io.note("(the conversation is complete — solidifying it into a draft…)");
    }
  } else {
    const present = pb.consumes.filter((d) => d in upstream);
    if (present.length === 0 && pb.consumes.length > 0) {
      io.say(`This derived step needs upstream artifacts (${pb.consumes.join(", ")}) and none exist yet. Author those first.`);
      rl.close();
      return;
    }
    io.note("(derived step — no interview; drafting from your authorized artifacts)");
  }

  const draft = await runInduce(pb, llm, exchange, upstream, io);
  const authorized = await runConfirm(pb, draft, io, (feedback) =>
    runInduce(pb, llm, exchange, upstream, io, feedback),
  );

  writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.json`), JSON.stringify(toArtifact(pb, authorized), null, 2));
  if (exchange.length > 0) {
    writeFileSync(join(ARTIFACTS_DIR, `${pb.id}.transcript.json`), JSON.stringify(exchange, null, 2));
  }
  if (existsSync(sessionPath)) unlinkSync(sessionPath);

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
