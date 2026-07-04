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
  against). Start with [SCHEMA.md](playbooks/SCHEMA.md). All six conversation
  nodes exist (goal + the five interview questions), plus the first derived
  node, [character_sketch.yaml](playbooks/character_sketch.yaml), which composes
  from authorized upstream artifacts without an interview.
- `src/` — the CLI harness: playbook loader, LLM adapter (Anthropic API or local
  Ollama), and the elicit → induce → confirm engine.
- `artifacts/` — authorized artifacts + transcripts, written per node (gitignored;
  this is personal data).

## Running the harness

```sh
npm install
cp .env.example .env                           # then put your ANTHROPIC_API_KEY in .env

# With the Anthropic API (default: haiku for interviewing, opus for composition)
npm run interview                              # counseling_goal
npm run interview -- playbooks/role_models.yaml

# With a local model instead
LLM_PROVIDER=ollama LLM_SMALL_MODEL=llama3.1:8b npm run interview

# Non-interactive end-to-end test (scripted user, real model)
npm run smoke
```

Model tiers are overridable via `LLM_SMALL_MODEL` / `LLM_LARGE_MODEL`. During the
interview, `/skip` advances a topic and `/quit` exits.

## macOS app (local testing build)

```sh
npm run app          # dev: opens the Electron window directly
npm run app:build    # produces dist-app/Career Counseling-darwin-<arch>/Career Counseling.app
```

The app spawns the server with Electron's bundled Node (no dependency on shell
PATH) pointed at this project directory — the API key is read from the
project's `.env`, artifacts stay in `artifacts/`, and code changes apply on
next launch without rebuilding. If a server is already running on :4780 the
app reuses it. Unsigned, local-testing only — not for distribution. The
project path is baked in `app/main.cjs` (`CAREER_COUNSELING_DIR` overrides).

```sh
npm run app:dist     # self-contained shareable build → dist-app/Career-Counseling-arm64.zip
```

The shareable build bundles the server, playbooks, UI, production deps, and
the project's `.env` (the API key — recipients bill to it; use a capped,
revocable key). Recipients' artifacts live in their own
`~/Library/Application Support/career-counseling-app/artifacts`. Unsigned:
recipients must allow it once via System Settings → Privacy & Security →
"Open Anyway" (or `xattr -dr com.apple.quarantine` on the app). For Intel
Macs: `scripts/package-app.sh x64`.

## How the engine works

The engine owns progression; the model owns wording. Each conversation node runs
a stage machine from its playbook: the interviewer model writes one utterance at
a time, and after each user answer a separate small checker call evaluates the
stage's `done_when` checklist to decide whether to advance. Induction runs the
playbook's extraction steps with JSON-schema-constrained output, then verifies
every `x-verbatim` string against the user's actual words in code — one retry
with the violations fed back, then the draft is flagged. Nothing becomes an
artifact until the user authorizes it in the confirm step.
