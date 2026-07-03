# Career Counseling — system brief (business logic only)

## What it is

A guided self-counseling application implementing Mark Savickas's career
construction method. The user moves through a fixed journey of **checkpoints**;
at each one, a conversation or a derivation produces an **artifact** the user
edits and explicitly authorizes. The journey culminates in a concrete,
personalized action recipe. The client is the author throughout — the system
(an LLM under narrow, fully disclosed instructions) only elicits, organizes,
and drafts; nothing becomes real until the user authorizes it.

## The artifact graph

Checkpoints form a dependency DAG in five phases:

1. **Goal** — "How can this process be useful to you?" Captured verbatim,
   distilled, authorized. Parameterizes every derived node (but none of the
   raw interviews), can be amended after the portrait, and is re-read verbatim
   at the very end to verify it was met.
2. **Interview** (5 conversation nodes) — role models, favorite media,
   favorite story, motto, early recollections. Each records the user's stories
   in their own words. Early recollections is the most sensitive node: it is
   skippable, with a defined fallback (perspective inferred from role models).
3. **Induction** (5 derived nodes) — perspective, character sketch, preferred
   settings, script, advice to self. Each is composed from authorized upstream
   artifacts, one-to-one with its interview source.
4. **Portrait & intention** — the life portrait (a six-part identity
   narrative) and the identity statement ("I will be happy and successful
   when I…"), assembled from the user's own phrases.
5. **Action** — the action recipe (exploration plan, decisions, first steps)
   and a closing check: the original goal is read back, the user judges
   whether it was met, and their own motto is returned to them.

Each node declares what it **consumes** (upstream artifacts injected as
context) and what it **invalidates** (dependents that become stale when it is
re-authorized). Editing the goal stales all derived artifacts but never the
recorded interviews.

## Node lifecycle

`planned → available → in progress → drafted → authorized` (plus `stale` when
an upstream artifact changes). A node is *available* once its playbook exists;
*in progress* while a conversation has unsaved-to-artifact state; *authorized*
only after explicit user approval. Conversation progress persists after every
user turn — quitting never loses an interview, and any node can be resumed or
redone. Re-running a node produces a proposal against the current artifact,
never a silent overwrite.

## The per-node loop

Every checkpoint runs the same three phases:

1. **Elicit** (conversation nodes only) — a staged interview. The engine owns
   progression: the interviewer model only writes the next utterance under a
   compiled persona + hard guardrails + per-topic anchor question and probe
   guidance; after each user answer a separate checker call evaluates the
   topic's completion checklist and the engine decides whether to advance.
2. **Induce** — narrow extraction/composition steps with schema-constrained
   output. The core guarantee: every field marked *verbatim* must be an exact
   quote of the user's words (or of authorized upstream artifact content),
   verified mechanically outside the model — one retry with violations fed
   back, then the draft is flagged. The model can never silently paraphrase
   the user.
3. **Confirm** — the user reviews the draft (either picking/editing among
   candidate phrasings, or reviewing the structured result with a
   revise-with-feedback loop) and authorizes it. Authorization is the only way
   an artifact comes into existence or propagates downstream.

## Invariants

- **User authorship** — every artifact is approved, editable, and revocable by
  the user; drafts never flow downstream.
- **Verbatim grounding** — artifacts are built from the user's own words,
  enforced in code, independent of model quality.
- **Full transparency** — everything the model is instructed to do is defined
  in per-node declarative playbooks and is completely disclosable to the user;
  there is no hidden prompt. The compiled instructions shown are generated
  from the same source that drives the live session.
- **Safety** — the sensitive node carries hard rules: no probing of painful
  material, explicit skip/pause paths, crisis-resource escalation, no
  interpretation during collection.
- **Privacy** — the material (childhood memories, life stories) is deeply
  personal; all artifacts and transcripts live locally with the user.
- **Sequencing** — the interview order is deliberate (trust builds toward the
  most personal question); first pass follows it, revisiting is free.
- **Model economy** — interviewing, extraction, and checking run on a small
  model; only literary composition (sketch, portrait) uses a large one. The
  system is provider-agnostic (hosted API or local model).

## Roles

Self-guided client today; a counselor-assisted mode later (same engine — the
counselor reviews, annotates, and co-signs, but the client remains the
author). The transparency layer doubles as the counselor's method view.
