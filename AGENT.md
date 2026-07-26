# AGENT.md

Working notes for coding agents (and humans doing agent-shaped work) in this
repository. [README.md](README.md) explains *what* the product is and how the
method works — read it first. This file is the operational layer: what must
never break, where truth lives, how to prove a change works, and which traps
have already cost real hours.

## Commands

```sh
npm test              # 29 deterministic unit tests, no network (~200ms)
npm run test:ui       # 8 braid UI scenarios in a hidden Electron window (~39s)
npm run typecheck     # tsc --noEmit
npm run ui            # dev server → http://localhost:4780
npm run app           # Electron shell against the live project dir
npm run app:dist      # macOS zip → dist-app/  (:win, :linux for the others)
```

Live-model harnesses (need keys, cost money, never run unasked):
`npm run smoke` (scripted end-to-end), `npm run golden` (plays the book's case
through the real engine into a profile), `npm run judge` (LLM-as-judge scoring
of golden output), `npm run probe` (verify a provider's privacy flags and
structured-output support), `node scripts/checker-regression.mjs` (replays real
transcripts through the stage checker).

## Non-negotiables

These are the product. A change that breaks one is wrong even if it passes.

1. **Verbatim discipline.** Any schema string marked `x-verbatim: true` must
   literally appear in the client's recorded words or in an authorized upstream
   artifact. Enforced in code ([src/verbatim.ts](src/verbatim.ts)), never by
   asking the model nicely. Violations retry once with the offenders fed back,
   then the draft is flagged — never silently accepted.
2. **The client authorizes.** Nothing becomes an artifact without an explicit
   authorize action. Artifacts record `origin` (`manual | generated | mixed |
   skipped`) and a timestamp that drives staleness.
3. **Never fabricate to fill a schema.** Optional material is nullable or an
   empty array, and the prompts say so out loud. Quotas (`minItems`) that force
   the model to invent are bugs — this is why early recollections extracts at
   `minItems: 0`.
4. **Recorded words are immutable.** Derived artifacts go stale when a source is
   re-authorized; conversation artifacts never do. Nothing is deleted or
   silently rewritten.
5. **Transparency.** Compiled prompts stay visible in the UI, exactly as sent.

## Where truth lives

**Playbooks:** `playbooks/*.yaml` is the source. The desktop server loads those
files directly; [src/playbooks-data.ts](src/playbooks-data.ts) is a **generated**
bundle for mobile (no filesystem, no YAML parser at runtime).

```sh
node scripts/bundle-playbooks.ts   # after every playbook edit
```

Editing the generated file by hand is how the two drifted 27 paths apart and the
desktop app silently ran months-old prompts. If you suspect drift, deep-diff
every playbook: load each yaml through `loadPlaybook` and compare against
`PLAYBOOKS[id]` key by key.

**Journey state:** the server computes statuses from the filesystem
([src/journey.ts](src/journey.ts)) — artifact = authorized, session/draft =
in_progress, playbook + met dependencies = available, else planned. The UI may
paint optimistically during a ceremony but always resyncs to server truth.

**Copy:** [public/i18n.js](public/i18n.js) holds every user-facing string, EN and
RU at exact key parity (161 each — check before committing). Node titles and
descriptions come from [src/map.ts](src/map.ts); playbook-authored copy
(anchor questions, `opening_i18n`) lives in the yaml.

## The cursor-war rule (desktop braid)

On macOS, AppKit and Chromium fight over the cursor whenever hover is
re-evaluated under a **stationary** pointer. Anything that moves near a parked
cursor re-arms the race and flips the palm to an arrow: per-frame JS style
writes, main-thread CSS animations (a `var()` inside keyframes de-optimizes to
main thread), even compositor transform animations.

So: **all idle motion in the braid is canvas paint.** Sway, wireframe spin,
glow, sonar ping, wake growth, the α pulse, the Ω spin, Saturn rings, thinking
dots and the rotating phrase are drawn on `.br-live` (the strip canvas) and a
small inline canvas in the chat. Colors resolve once per layout via a
1×1-canvas pixel read into `J.paint`. The waking node's only hit surface is a
static `[data-pad]` that outreaches the sway; décor SVG is `pointer-events:
none`; hover lives in canvas state, not the DOM.

Ceremonies (travel, solidify, shake, camera moves) may write styles freely —
they always follow a click, when the pointer is moving anyway.

Adding an animation? Canvas paint, or keep it far from anything clickable. The
`the pointer field` UI scenario enforces this: zero DOM mutations and zero
`getAnimations()` in the strip across pumped idle frames.

## Proving a change works

**Never claim a UI change works without seeing it.** The order that pays off:

1. **Units** ([test/](test/)) — engine logic against a fake `LlmAdapter`. Fast,
   deterministic, no network. Add one for every state-machine branch.
2. **UI scenarios** ([test/ui/driver.mjs](test/ui/driver.mjs)) — real
   `braid.js` + CSS in a hidden Electron window with a fake ctx; the test plays
   the counselor through the captured surface. Add a scenario for anything a
   tester could see.
3. **Live sandbox** — run the dev server against a throwaway artifacts dir
   (`.claude/launch.json` has the `ui-sandbox` config on port 4792), seed state
   by copying a profile in, drive the page, screenshot.
4. **Electron probes** for anything the browser pane cannot see — OS-level
   behavior, `cursor-changed` telemetry, window lifecycle. Synthetic
   `sendInputEvent` reaches the renderer only; it **cannot** see the real
   NSCursor, so OS-layer claims need a human with a real mouse.

Useful debug seams shipped in the braid: `Braid._frame(ts)` steps the rAF loop
manually (the preview pane is hidden, so real frames never fire there) and
`Braid._debug()` returns live state.

When a test *should* have caught something, tighten the test in the same change
— then mutate the fix back out to prove the test fails.

## Conventions

- **Match the surrounding code.** Dependency-free vanilla JS in `public/`,
  TypeScript with `.ts` import specifiers in `src/`, no build step for the UI.
- **Comments explain *why*, especially the non-obvious.** Most comments here
  encode a hard-won constraint ("not rAF: a hidden tab suspends frames
  entirely"). Preserve them; when a fix depends on a subtlety, leave the note.
- **RU is a first-class language, not a translation.** Informal «ты», neutral
  (non-gendered) past-tense forms, established Russian psych terminology. When
  unsure of register, ask rather than guess.
- **Geometry constants are load-bearing.** The braid's numbers come from design
  handoffs; when porting between DOM and canvas, carry them verbatim and say so
  in a comment.

## Traps

- **`npm run app` reuses a running server.** Source changes in `src/` need a
  full quit + relaunch; browser-side changes only need a reload.
- **The preview pane is hidden**, so `requestAnimationFrame` never fires and
  long polls exceed tool timeouts. Step frames with `Braid._frame`, keep polls
  short, prefer structural assertions.
- **The agent shell cannot reach the npm registry** (self-signed cert in the
  chain, even offline). Installing new packages needs the maintainer's terminal
  — design around zero new dependencies whenever possible.
- **Scratchpad and sandbox state are wiped between sessions.** Re-seed profiles
  from `artifacts/profiles/` and set `localStorage` explicitly.
- **The braid is desktop-only**: `Braid.active()` requires a ≥900px viewport,
  a non-Capacitor runtime, and `localStorage.braid !== "0"` (the escape hatch
  back to the card UI).

## Keys, signing, and release

- `scripts/package-app.sh` **bakes runtime keys** (`LLM_*`, `OPENAI_API_KEY`)
  into shareable builds by design — recipients bill to the maintainer's keys, so
  they must be capped and revocable. The OpenRouter **management/provisioning
  key is never baked** (it can mint keys against the account); keep it out of
  bundles, logs, and commits.
- macOS releases are Developer ID signed, notarized and stapled by
  `scripts/sign-mac.sh`. The notary app-specific password lives **only** in the
  macOS keychain (`xcrun notarytool store-credentials cc-notary`) — never in the
  repo.
- System and security settings (TCC microphone permissions, keychain entries)
  are the maintainer's to change, never the agent's. Diagnose, hand over the
  exact command, and stop there.
- Artifacts are personal data. `artifacts/` is gitignored and never leaves the
  machine; don't paste transcript content into commits, issues, or logs.

## Working agreement

- Verify directly before delegating: run the thing, read the state, screenshot
  it. Fan out subagents or workflows only when asked.
- Commits happen when the maintainer says so, after they've seen the change
  work. Pushes are a separate, explicit ask.
- Report outcomes plainly — if a test fails, show the output; if something was
  skipped, say which part and why.
