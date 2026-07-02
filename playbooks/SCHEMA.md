# Playbook schema — v0.1

A playbook fully defines one node on the map. It is the single source of truth,
consumed in two directions:

1. **Compiled** into the interviewer/extractor prompts the model runs under.
2. **Rendered** verbatim to the user in the node's close-up view (transparency
   principle: if it isn't in the playbook, the model was never told it).

Playbooks are YAML, versioned with the artifact instances they produce (an
artifact records the playbook version that formed it).

## Top-level fields

| Field | Meaning |
|---|---|
| `id` | Node type, snake_case. Matches the map node. |
| `version` | Semver. Bump on any change; artifacts pin the version they were formed under. |
| `kind` | `conversation` (blue: formed from a chat transcript) or `derived` (teal: formed from upstream artifacts). |
| `sector` | `goal` \| `interview` \| `induction` \| `portrait` \| `action`. |
| `title` | Map label. |
| `purpose` | Plain-language paragraph shown to the user *before* the node starts. What happens here, with whose words, and what gets produced. |
| `consumes` | Upstream node ids whose authorized artifacts are injected as context. |
| `invalidates` | Direct dependents marked stale when this node's artifact is (re)authorized. Transitive propagation is the engine's job — list direct edges only. |
| `elicit` | Conversation phase (only for `kind: conversation`). |
| `induce` | Extraction/composition pipeline run when elicitation completes, or on re-run. |
| `confirm` | How drafts are presented for authorization. |
| `artifact` | Schema and rendering of the authorized artifact. |

## `elicit`

- `persona` — tone and stance rules for the interviewer.
- `guardrails` — hard rules, always in the prompt, non-negotiable. Safety rules
  live here (acknowledge pain, never probe it, offer skip/pause, crisis resources).
- `stages` — a linear state machine. The engine owns stage progression; the model
  only ever writes the next utterance. Each stage:
  - `id`, `goal` — what this stage must obtain.
  - `opening` — the stage's anchor question (book wording wherever possible; it is
    load-bearing). May contain `{{placeholders}}` filled by the engine.
  - `probes` — `when`/`then` pairs in natural language. Compiled into the stage
    prompt; the interviewer model applies them judgmentally. They are scaffolding,
    not branches the engine executes.
  - `done_when` — a checklist in natural language. After each user message a
    small **checker call** (separate from the interviewer, `model_tier: small`)
    evaluates the checklist against the transcript and returns booleans. The
    engine advances the stage when all items pass. This keeps progression
    deterministic-ish without trusting the interviewer to self-report.

## `induce`

Ordered `steps`. Each step is one narrow LLM call:

- `id`, `task` — one sentence of intent.
- `model_tier` — `small` (interviewing, extraction, checking) or `large`
  (literary composition; in practice only the life portrait).
- `output_schema` — JSON Schema. Two conventions:
  - `x-verbatim: true` on a string means the engine verifies it appears in the
    source transcript (normalized: case, whitespace, straight/curly quotes).
    Violations get one retry with the error fed back, then flag for the user.
  - `x-candidates` (minItems/maxItems 2–3) marks arrays presented as
    alternatives for the user to pick from — the book's own pattern of preparing
    two success formulas in advance.
- `validation` — extra rules beyond the schema, natural language, enforced by a
  checker call or code where possible.

## `confirm`

- `present` — `candidates` (pick/edit one of several drafts) or
  `structured_review` (edit the structured artifact directly).
- `authorize_language` — the sentence shown at the moment of authorization. It
  should say what authorizing *means* (what unlocks, what gets built from this).

## `artifact`

- `schema` — shape of the authorized artifact (JSON Schema).
- `render` — template for the node card on the map.

Engine-level invariants (not repeated per playbook):

- An artifact is `draft` until the user authorizes it; drafts never propagate.
- Re-running a node produces a **proposal diffed against the authorized version**,
  never a silent overwrite.
- Authorizing marks `invalidates` targets stale; staleness is a badge, not a modal.
