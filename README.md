# Career Counseling

A local-first app that guides a person through Mark Savickas's career construction
counseling (*Career Counseling*, 2nd ed., APA 2019) as a journey across a map of
artifacts, with an LLM playing the interviewer under narrow, fully visible
instructions.

## The model

The counseling process is a DAG of **artifact nodes**. Every node is a
process+artifact pair: a conversation or derivation *forms* the artifact, and the
user *authorizes* it. Nothing is final until the user says so — the client is the
author; the model is a witness with a public briefing.

Map sectors:

1. **Set the goal** — "How can this process be useful to you?" Elicited, distilled,
   authorized. Re-read verbatim at the closing check.
2. **Career construction interview** — five story checkpoints: role models, favorite
   media, favorite story, motto, early recollections (+ headlines).
3. **Induction** — five derived artifacts: character sketch, preferred settings
   (RIASEC), script, advice to self, perspective.
4. **Portrait & intention** — the six-part life portrait, then the identity
   statement ("I will be happy and successful when I…").
5. **Action** — the action recipe (explore → decide → first steps), then the closing
   check: goal met? Repeat the motto.

The goal parameterizes every induced node but none of the raw conversations —
editing it stales the derived layer without invalidating any interview.

## Decisions

- Local-first macOS first (web core + Tauri wrapper); same codebase published later
  as a web app (API-mode only) for users unconcerned about privacy. Platform deltas
  isolated behind adapters: storage, LLM transport, secrets, export.
- v1 = linear guided journey; staleness/recalculation in v2.
- No voice for now. No external data services (O*NET, job boards) in v1; RIASEC
  taxonomy comes from the book itself.
- Two modes eventually: self-guided client and counselor-assisted. In both, the
  model's instructions (playbooks) are always visible to the user.
- Every quoted phrase in any artifact must appear verbatim in the user's transcript
  — mechanically enforced, model-independent.

## Repository layout

- `playbooks/` — the declarative node definitions (the contract everything builds
  against). Start with [SCHEMA.md](playbooks/SCHEMA.md), then the two reference
  playbooks: [counseling_goal.yaml](playbooks/counseling_goal.yaml) and
  [role_models.yaml](playbooks/role_models.yaml).
