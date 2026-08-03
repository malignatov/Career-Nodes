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
  /** Optional plain-language warm-up spoken before the anchor question in the
   * baked opener (first stage only). UI-side framing for the client — it never
   * becomes part of the anchor and is never model-generated. */
  opening_preamble?: string;
  opening_preamble_i18n?: Record<string, string>;
  probes?: Probe[];
  done_when: string[];
  /** A stage that gives rather than asks (the closing send-off). The engine
   * delivers its utterance and ends elicitation without waiting for a reply —
   * `done_when` is never evaluated, because there is no answer to check. */
  terminal?: boolean;
}

export interface InduceStep {
  id: string;
  task: string;
  model_tier: Tier;
  /** Sampling temperature for this step (extractions want ~0.2; default = provider default). */
  temperature?: number;
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
  /** Translated purpose text, keyed by language code (e.g. ru). User-facing
   * only — the purpose is never compiled into a model prompt. */
  purpose_i18n?: Record<string, string>;
  consumes: string[];
  invalidates: string[];
  amendable_after?: string;
  /** Unlock rule: "any" (default for derived) or "all" (default for conversation). */
  gate?: "all" | "any";
  /** The step is designed to be declinable — surfaces a visible "Skip this
   * step" affordance (the typed /skip escape works everywhere regardless). */
  skippable?: boolean;
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
    /** Translated authorization sentence, keyed by language code (e.g. ru). */
    authorize_language_i18n?: Record<string, string>;
  };
  artifact?: {
    schema: Record<string, unknown>;
    render?: string;
  };
}

export interface ExchangeEntry {
  speaker: "interviewer" | "user";
  text: string;
  /** Turns from an amend conversation over a presented draft, as opposed to
   * the original interview. Lets transcripts render the amend divider.
   * "amend_withdrawn" marks a request the user took back: it stays in the
   * record, because it was said, but never feeds a recompose. */
  phase?: "amend" | "amend_withdrawn";
}

export interface Artifact {
  playbook_id: string;
  playbook_version: string;
  authorized_at: string;
  /** How the content was produced. Absent on artifacts predating the field — treat as "generated".
   * "skipped": the user chose to close the step without material; content is schema-shaped and empty. */
  origin?: "manual" | "generated" | "mixed" | "skipped";
  content: Record<string, unknown>;
}
