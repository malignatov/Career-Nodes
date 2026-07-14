/**
 * Non-interactive end-to-end test: runs the counseling_goal playbook against a
 * real model with a scripted "user", then auto-authorizes the first candidate.
 * Usage: npm run smoke
 */
import { loadPlaybook } from "../src/playbook.ts";
import { createAdapter } from "../src/llm-node.ts";
import { runElicit, runInduce, type SessionIO } from "../src/engine.ts";

const cannedAnswers = [
  "I keep circling around leaving consulting but I never actually do anything about it. I want to understand what is holding me back.",
  "Honestly, worth it would mean I finally know whether the problem is the job itself or something in me, and I have one concrete next step.",
  "No, that covers it.",
  "Yes, that is right.",
  "Nothing to add.",
];

async function main(): Promise<void> {
  const pb = loadPlaybook("playbooks/counseling_goal.yaml");
  const llm = createAdapter();
  console.log(`smoke: ${pb.id} v${pb.version} via ${llm.describe()}`);

  let i = 0;
  const io: SessionIO = {
    say: (t) => console.log(`\n[interviewer] ${t}`),
    note: (t) => console.log(`  ${t}`),
    ask: async () => {
      const answer = cannedAnswers[Math.min(i, cannedAnswers.length - 1)];
      i++;
      console.log(`[user] ${answer}`);
      return answer;
    },
  };

  const elicited = await runElicit(pb, llm, io);
  console.log(`\nsmoke: elicitation done (${elicited.exchange.length} exchanges)`);

  const draft = await runInduce(pb, llm, elicited.exchange, {}, io);
  console.log("\nsmoke: induced draft:");
  console.log(JSON.stringify(draft, null, 2));

  const candidates = (draft.candidates ?? []) as string[];
  if (candidates.length < 2) throw new Error("expected at least 2 restatement candidates");
  if (typeof draft.request_verbatim !== "string") throw new Error("missing request_verbatim");
  console.log(`\nsmoke: OK — ${candidates.length} candidates, verbatim request captured`);
}

main().catch((err) => {
  console.error("smoke: FAILED", err);
  process.exit(1);
});
