export type Tier = "small" | "large";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Probe {
  when: string;
  then: string;
}

export interface Stage {
  id: string;
  goal: string;
  opening: string;
  /** Translated anchor wording, keyed by language code (e.g. ru). */
  opening_i18n?: Record<string, string>;
  probes?: Probe[];
  done_when: string[];
}

export interface InduceStep {
  id: string;
  task: string;
  model_tier: Tier;
  output_schema: Record<string, unknown>;
  validation?: string[];
}

export interface Playbook {
  id: string;
  version: string;
  kind: "conversation" | "derived";
  sector: string;
  title: string;
  purpose: string;
  consumes: string[];
  invalidates: string[];
  amendable_after?: string;
  /** Unlock rule: "any" (default for derived) or "all" (default for conversation). */
  gate?: "all" | "any";
  elicit?: {
    persona: string;
    guardrails: string[];
    stages: Stage[];
    /** Inject authorized upstream artifacts into the interviewer's context (e.g. the closing ritual). */
    share_upstream?: boolean;
  };
  induce?: {
    steps: InduceStep[];
  };
  confirm?: {
    present: "candidates" | "structured_review";
    choice_field?: string;
    authorize_language: string;
  };
  artifact?: {
    schema: Record<string, unknown>;
    render?: string;
  };
}

export interface ExchangeEntry {
  speaker: "interviewer" | "user";
  text: string;
}

export interface Artifact {
  playbook_id: string;
  playbook_version: string;
  authorized_at: string;
  /** How the content was produced. Absent on artifacts predating the field — treat as "generated". */
  origin?: "manual" | "generated" | "mixed";
  content: Record<string, unknown>;
}
