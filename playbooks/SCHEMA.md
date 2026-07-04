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
| `gate` | Unlock rule against non-goal `consumes`: `any` (default for derived — partial upstream is workable) or `all` (default for conversation; set explicitly on the life portrait and action recipe, which need their full source sets). |
| `invalidates` | Direct dependents marked stale when this node's artifact is (re)authorized. Transitive propagation is the engine's job — list direct edges only. |
| `elicit` | Conversation phase (only for `kind: conversation`). |
| `induce` | Extraction/composition pipeline run when elicitation completes, or on re-run. |
| `confirm` | How drafts are presented for authorization. |
| `artifact` | Schema and rendering of the authorized artifact. |

## `elicit`

- `persona` — tone and stance rules for the interviewer.
- `guardrails` — hard rules, always in the prompt, non-negotiable. Safety rules
  live here (acknowledge pain, never probe it, offer skip/pause, crisis resources).
- `share_upstream` — inject the authorized consumed artifacts into the
  interviewer's context (used by the closing check to read the goal and motto
  back verbatim). Off by default to keep interview prompts lean.
- `stages` — a linear state machine. The engine owns stage progression; the model
  only ever writes the next utterance. Each stage:
  - `id`, `goal` — what this stage must obtain.
  - `opening` — the stage's anchor question (book wording wherever possible; it is
    load-bearing). May contain `{{placeholders}}` filled by the engine.
  - `opening_i18n` — optional translated anchor wordings keyed by language code
    (`ru: …`). Used verbatim for the session's language when present.
    The **first stage's opener is baked, not generated**: the engine emits
    greeting + anchor question deterministically (no model call), seeds it into
    the transcript as the interviewer's first turn, and flags it to the UI as an
    anchor question.
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
  (literary composition; the character sketch and life portrait).
- `output_schema` — JSON Schema. Three conventions:
  - `x-verbatim: true` on a string means the engine verifies it appears in the
    node's verbatim source (normalized: case, whitespace, straight/curly
    quotes). The source is the user's interview turns **plus every string value
    of the consumed upstream artifacts** — which is how `derived` nodes, which
    have no transcript, still get hard quote-grounding. Violations get one
    retry with the error fed back, then flag for the user.
  - Optional fields must be nullable (`type: ["string", "null"]`), because the
    structured-output API requires every property to be emitted — nullable lets
    the model say "not provided" instead of fabricating content.
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

## `derived` nodes

A playbook with `kind: derived` has no `elicit` block. Its induction consumes
the authorized artifacts named in `consumes` instead of a transcript, and its
`x-verbatim` strings are checked against those artifacts' string content. The
CLI refuses to run a derived node when none of its upstream artifacts exist,
and warns (but proceeds) when some are missing — e.g. the character sketch can
be drafted from role models alone before the perspective exists.

Engine-level invariants (not repeated per playbook):

- An artifact is `draft` until the user authorizes it; drafts never propagate.
- Re-running a node produces a **proposal diffed against the authorized version**,
  never a silent overwrite.
- Authorizing marks `invalidates` targets stale; staleness is a badge, not a modal.
- Conversation progress persists to `artifacts/<id>.session.json` after every
  turn — the user's answers and the interviewer's generated questions alike
  (`{exchange, stage_index, elicit_done}`) — so resuming never regenerates a
  question the user already saw; a session whose record ends with an unanswered
  question resumes with zero model calls. The baked opener alone is not
  persisted (peeking at a node must not mark it in-progress). The file is
  deleted once the artifact is authorized. Exiting at any point never loses an
  interview.
