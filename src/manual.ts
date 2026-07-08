/**
 * Practitioner mode: the playbook running on human hardware. Everything here
 * works without any model — the schemas drive a manual editing form, the
 * verbatim rules are checked in code, and a hand-recorded interview lands in
 * the same session format the AI interviewer produces.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExchangeEntry, Playbook } from "./types.ts";
import { stageOpening, stringValuesDeep, type SessionLang } from "./engine.ts";
import { verbatimViolations } from "./verbatim.ts";

/**
 * The shape a practitioner fills in by hand: the union of the induce steps'
 * output schemas (those are fully specified — structured outputs demand it),
 * with the candidates mechanism collapsed to the final chosen field, exactly
 * as runConfirm would collapse it.
 */
export function manualFormSchema(pb: Playbook): { properties: Record<string, unknown>; required: string[] } {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  for (const step of pb.induce?.steps ?? []) {
    const s = step.output_schema as { properties?: Record<string, unknown>; required?: string[] };
    Object.assign(properties, s.properties ?? {});
    for (const r of s.required ?? []) required.add(r);
  }
  const field = pb.confirm?.present === "candidates" ? pb.confirm.choice_field : undefined;
  if (field) {
    delete properties.candidates;
    required.delete("candidates");
    properties[field] = { type: "string" };
    required.add(field);
  }
  return { properties, required: [...required] };
}

/** Recorded interview for a node, whether in progress (.session) or settled (.transcript). */
export function loadExchange(id: string, dir: string): ExchangeEntry[] {
  const sessionPath = join(dir, `${id}.session.json`);
  if (existsSync(sessionPath)) {
    return (JSON.parse(readFileSync(sessionPath, "utf8")) as { exchange: ExchangeEntry[] }).exchange ?? [];
  }
  const transcriptPath = join(dir, `${id}.transcript.json`);
  if (existsSync(transcriptPath)) {
    return JSON.parse(readFileSync(transcriptPath, "utf8")) as ExchangeEntry[];
  }
  return [];
}

/** Everything a verbatim string may legitimately quote: the user's recorded words + upstream artifact text. */
export function verbatimSource(pb: Playbook, dir: string, upstream: Record<string, unknown>): string {
  return [
    ...loadExchange(pb.id, dir).filter((e) => e.speaker === "user").map((e) => e.text),
    ...stringValuesDeep(upstream),
  ].join("\n");
}

/**
 * Checks hand-authored content against the same x-verbatim rules the engine
 * enforces on model output. The walker only visits keys present in both the
 * value and a step schema, so the candidates→choice_field rename is harmless.
 */
export function manualWarnings(pb: Playbook, content: Record<string, unknown>, source: string): string[] {
  const all = (pb.induce?.steps ?? []).flatMap((step) => verbatimViolations(content, step.output_schema, source));
  return [...new Set(all)];
}

export interface ManualSession {
  exchange: ExchangeEntry[];
  stage_index: number;
  elicit_done: boolean;
  /** Per-stage recorded answers, kept for round-trip editing in the script view. */
  manual_answers: Record<string, string>;
}

/**
 * A hand-recorded interview in the exact session format the AI interviewer
 * writes: each answered stage becomes its anchor question plus the client's
 * words. Downstream induction cannot tell the difference.
 */
export function buildManualSession(
  pb: Playbook,
  answers: Record<string, string>,
  lang?: SessionLang,
): ManualSession | null {
  const stages = pb.elicit?.stages ?? [];
  const exchange: ExchangeEntry[] = [];
  let lastAnswered = -1;
  stages.forEach((stage, i) => {
    const text = (answers[stage.id] ?? "").trim();
    if (!text) return;
    exchange.push({ speaker: "interviewer", text: stageOpening(stage, lang) });
    exchange.push({ speaker: "user", text });
    lastAnswered = i;
  });
  if (lastAnswered === -1) return null;
  const done = stages.every((s) => (answers[s.id] ?? "").trim());
  return {
    exchange,
    stage_index: done ? stages.length : lastAnswered,
    elicit_done: done,
    manual_answers: answers,
  };
}
