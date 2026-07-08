# Career Counseling

A local-first app that guides a person through Mark Savickas's career construction
counseling (*Career Counseling*, 2nd ed., APA 2019) as a journey across a map of
artifacts — with an AI interviewer working under narrow, fully visible
instructions, or with no AI at all.

## Attribution

The ideas this app runs on are **Mark L. Savickas's**: career construction
theory, the Career Construction Interview (the goal question and the five
stimulus questions), the assessment protocol, and the arc from small stories to
life portrait, identity statement, and action. This repository contributes only
the software process around his method.

> Savickas, M. L. (2019). *Career counseling* (2nd ed., Theories of
> Psychotherapy Series). American Psychological Association.
> https://doi.org/10.1037/0000105-000

The RIASEC vocational personality types used in the preferred-settings step are
John L. Holland's. This project is independent — not affiliated with or endorsed
by Mark Savickas or the APA — and contains no text from the book. If you intend
to use this seriously, with yourself or with clients, read the book first.

## The model

The counseling process is a DAG of **artifact nodes**. Every node is a
process+artifact pair: a conversation or derivation *forms* the artifact, and the
client *authorizes* it. Nothing is final until the client says so — the client is
the author; the model is a witness with a public briefing.

Map phases:

1. **Goal** — "How can this process be useful to you?" Elicited, distilled,
   authorized. Re-read verbatim at the closing check.
2. **Career construction interview** — five story checkpoints: role models,
   favorite media, favorite story, motto, early recollections (+ headlines).
3. **Induction** — five derived artifacts: character sketch, preferred settings
   (RIASEC, book taxonomy only), script, advice to self, perspective.
4. **Portrait & intention** — the six-movement life portrait, then the identity
   statement ("I will be happy and successful when I…").
5. **Action** — the action recipe (exploration steps, week one, the barrier),
   then the closing check: the goal is read back verbatim, the motto returned.

The goal parameterizes every induced node but none of the raw interviews —
amending it stales the derived layer without invalidating a single recorded word.
Derived artifacts go **stale** (never deleted, never silently rewritten) when a
source is re-authorized after them.

## Two modes

**Client mode** — self-guided. An AI interviewer conducts each conversation one
question at a time; extraction and composition run against JSON schemas; every
draft lands in a review screen where the client amends, swaps wording, or
authorizes. Session openers are deterministic (no model call), progress persists
after every turn, and any settled artifact reopens instantly for review.

**Practitioner mode** — AI-agnostic. The playbook runs on human hardware: the
interview script (anchor questions, probes, completion checklists) is displayed
for the counselor, answers are recorded verbatim per stage, and every derived
artifact is authored in a schema-driven form. The modal splits into two panes:
primary material (the client's words / authorized sources) on the left, the
derived artifact on the right. Model assists — "generate from the client's
words" and amend-by-feedback — appear only when a key is configured. Client
profiles keep each person's journey in its own artifacts directory.

Both modes share the same invariants:

- **Transparency** — the playbooks (all model instructions) are always visible
  in the UI, compiled exactly as sent.
- **Verbatim enforcement** — every `x-verbatim` string must literally appear in
  the client's recorded words or authorized artifacts; checked in code, not by
  the model.
- **Authorization** — artifacts record their provenance
  (`manual | generated | mixed`) and a timestamp that drives staleness.

## Quick start

```sh
npm install
cp .env.example .env    # add keys — every one of them is optional
npm run ui              # → http://localhost:4780
```

- `ANTHROPIC_API_KEY` — enables the AI interviewer and generation
  (default tiers: Haiku for interviewing/extraction, Opus for composition;
  override via `LLM_SMALL_MODEL` / `LLM_LARGE_MODEL`, or use a local model with
  `LLM_PROVIDER=ollama`).
- `OPENAI_API_KEY` — enables voice dictation: a mic button on every editable
  text field, live transcription streaming while you speak (OpenAI realtime,
  `gpt-realtime-whisper`; audio is proxied through the local server, the key
  never reaches the page).
- No keys at all — the app runs fully offline in practitioner mode.

The UI ships in English and Russian with light and dark themes. The CLI harness
is also available: `npm run interview` (`/skip`, `/quit`), `npm run smoke` for a
scripted end-to-end test against the real API.

## Desktop builds

```sh
npm run app              # dev: Electron window on the live project dir
npm run app:dist         # macOS  → dist-app/Career-Counseling-darwin-arm64.zip
npm run app:dist:win     # Windows → dist-app/Career-Counseling-win32-x64.zip
npm run app:dist:linux   # Ubuntu  → dist-app/Career-Counseling-linux-x64.tar.gz
```

The shareable builds are self-contained (server, playbooks, UI, production
deps) **and bake in your `.env`** — recipients bill to your keys, so use capped,
revocable ones. Recipient artifacts live in their own per-user app-data
directory. Builds are unsigned: macOS needs "Open Anyway", Windows needs
SmartScreen's "Run anyway", and Ubuntu may need `--no-sandbox` or a root-owned
`chrome-sandbox` on releases that restrict unprivileged user namespaces.

## How the engine works

The engine owns progression; the model owns wording. Each conversation node runs
a stage machine from its playbook: the interviewer model writes one utterance at
a time, and after each answer a separate small checker call evaluates the stage's
`done_when` checklist to decide whether to advance. Induction runs the playbook's
extraction steps with JSON-schema-constrained output, then verifies every
`x-verbatim` string against the client's actual words in code — one retry with
the violations fed back, then the draft is flagged. Hand-recorded interviews are
written in the same session format the AI interviewer produces, so downstream
induction cannot tell the difference.

## Repository layout

- `playbooks/` — all fifteen declarative node definitions; the contract
  everything builds against. Start with [SCHEMA.md](playbooks/SCHEMA.md).
- `src/` — engine (elicit → induce → confirm), server (REST + WebSocket,
  profiles, manual authoring, voice proxy), LLM adapters (Anthropic / Ollama),
  verbatim checks, CLI harness.
- `public/` — dependency-free vanilla JS UI: journey map, session modal,
  practitioner workbench, i18n.
- `app/` — the Electron shell; `scripts/package-app.sh` builds all three
  platforms.
- `artifacts/` — authorized artifacts, transcripts, drafts, and client profiles
  (gitignored; this is personal data and never leaves the machine).

## License

[MIT](LICENSE) © 2026 Mikhail Ignatov — covering the code and playbook
engineering only. The method itself is Savickas's; see
[Attribution](#attribution).
