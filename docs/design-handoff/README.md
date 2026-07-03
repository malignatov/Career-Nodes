# Handoff: Career Counseling — Journey & Node UI

## Overview
UI for a guided self-counseling app (Savickas career construction method). The user moves through a fixed journey of ~15 **checkpoints** organized in 5 phases (Goal → Interview → Induction → Portrait & intention → Action). Each checkpoint is a **node** with a lifecycle (`planned → available → in progress → drafted → authorized`, plus `stale`). This handoff covers:

1. **Journey progress view** — the "home" screen: all nodes, grouped by phase, each wearing its lifecycle state and a dependency hint.
2. **Node session modal** — the chosen expand behavior (option 1b in the exploration): clicking a node opens a focused modal over the dimmed journey. Same shell hosts two views: **chat** (elicit) and **review & authorize** (confirm). On mobile the modal becomes a full-screen sheet.

## About the Design Files
The bundled `Career Journey.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behavior, not production code to copy. The task is to **recreate these designs in the target React codebase** using its established patterns and libraries. The file is a design-exploration canvas: **Turn 3 (top, id `3a`) is the interactive spec to implement**; turns 2 and 1 are earlier explorations kept for reference (turn 2 = static modal/mobile/review mocks; turn 1 = rejected expand behaviors).

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and copy are final unless noted. Recreate pixel-perfectly with your component library.

## Design Tokens

Colors (warm, calm, therapeutic):
- Canvas / page background: `#EFE9E0`
- Card background: `#FFFDF9`; modal/session surface: `#FFFFFF`; soft panel: `#F7F3EC`, `#FBF8F3`
- Borders: `#E4DACB` (solid), `#D6CBB9` (dashed, planned nodes), hairline dividers `#EFE7DA`
- Ink: `#3D362D`; secondary `#5C5346`/`#6B5F4F`; muted `#8A7E6E`; faint `#A79C8C`, `#B7AB99`
- Accent (primary action, terracotta): `#B4633F`; verbatim highlight bg `#F3E2D8`, text `#8A4A2C`
- State colors — authorized (sage): text `#6F8265`, bg `#E7ECE2`; in progress (amber): `#A97B2F` / `#F4E9D4`; available (teal): `#5F8787` / `#E1EBE9`; drafted (violet): `#7C6F9B` / `#EAE6F0`; planned (warm gray): `#9A8F80` / `#EFE9E0`
- Counselor bubble: `#F1EADF`; user bubble: `#DCE5DB` (text `#33402F`)
- Scrim: `rgba(61,54,45,.38)`; modal shadow: `0 24px 70px rgba(61,54,45,.4)`

Typography:
- Headings & artifact text: **Lora** (serif), 600. Journey title 26px; node titles 15–17px; modal title 22px; draft artifact text 17px/1.7 weight 500.
- UI & body: **Karla** (sans), 400–600. Bubbles 14px/1.55; summaries 13px/1.5; hints 11px; state chips 10.5px 600 letter-spacing .04em uppercase; phase labels 11px 600 letter-spacing .08em uppercase.
- Compiled model instructions: `ui-monospace/Menlo` 10.5px/1.55.

Shape & spacing:
- Radii: node cards 14–16px; modal 22px; panels 14–16px; chips/buttons/inputs pill (`99px`); condensed rows 12px; draft textarea 10px.
- Card padding: 13–15px vertical, 16–18px horizontal. Modal sections 16–22px. Vertical gap between journey cards: 10–11px.
- Modal width 560px (desktop), max-height-constrained; centered over scrim. Mobile: full-screen sheet, same header/composer, ≥44px touch targets.

## Screens / Views

### 1. Journey progress view (home)
- Header row: title "Your journey" (Lora 26) + subtitle "You author every step — nothing moves forward without your approval." Right-aligned: "N of 15 authorized" + 180×6px progress bar (track `#E4DACB`, fill `#6F8265`).
- Phase labels: "Phase 1 · Goal", "Phase 2 · Interview", etc.
- **Node card (actionable — available/in progress/drafted/authorized):** solid card (`#FFFDF9`, border `#E4DACB`). Row 1: title + state chip. Row 2: one-line summary — for authorized nodes show the artifact's distilled text in italic Lora; otherwise a fixed description. Row 3: dependency hint left ("↳ feeds Character sketch"), action button right (filled terracotta pill: Start/Resume/Review draft; outline pill: Redo when authorized).
- **Planned node (locked):** dashed border `#D6CBB9`, transparent bg, opacity .75, title + dep hint + PLANNED chip, no button.
- **Early recollections** additionally carries a SKIPPABLE chip (amber) and hint "fallback: Role models".
- Induction/Portrait/Action phases render as condensed 2-column grid rows (title + "uses …" hint + implicit planned style) until unlocked; once available they should get full cards like Interview nodes.
- State chips: uppercase pill; AUTHORIZED shows "✓".

### 2. Node session modal — chat view (elicit)
- Opens centered over the journey with scrim; journey remains visible behind (dimmed). Mobile: full-screen sheet.
- Header (bottom hairline): row 1 — left "← Journey · saved automatically" (exit; the suffix reassures persistence), right "Phase 1 · Goal" + state chip. Row 2 — node title (Lora 22) + **Transparency** toggle pill.
- Transparency panel (collapsed by default): soft panel with two blocks — "What's happening" (plain-language explanation) and "Model instructions (compiled)" (monospace, the actual compiled playbook text). This is the full-transparency invariant: content must come from the same source that drives the live session.
- Messages: counselor left (`#F1EADF`, radius 16/16/16/5), user right (`#DCE5DB`, radius 16/16/5/16), max-width ~78%. Optional centered micro-label above anchor questions: "Anchor question — asked of everyone, verbatim" (pill, `#F7F3EC`).
- When the engine's checker deems the topic complete, a violet pill button appears above the composer: "Draft my goal — in my words →".
- Composer (top hairline): pill input, placeholder "Write in your own words…", Enter submits; terracotta "Send" pill.

### 3. Node session modal — review & authorize view (confirm)
- Same shell/header, chip → DRAFTED; exit hint becomes "· draft kept until you decide".
- Explainer: "Your goal, distilled from the conversation. Highlighted phrases are your exact words — nothing was paraphrased."
- Draft panel (`#FBF8F3`, border, radius 16): kicker "DRAFT · YOUR GOAL"; artifact text in Lora 17/1.7 with **verbatim spans as `<mark>`** (`#F3E2D8`/`#8A4A2C`, radius 4). Below: verification line "✓ 2 verbatim quotes verified against your transcript" (sage). If user edited: "✓ Edited by you — your own words, verbatim by definition".
- Edit mode: textarea (Lora 15/1.6) + "Save wording" button.
- Action row: outline "Edit wording" / outline "Ask for changes" / filled sage "Authorize this goal" (flex 1 / 1 / 1.4).
- Footnote: "Authorizing unlocks the interview phase. Amending it later re-checks derived artifacts, never your recorded interviews."

## Interactions & Behavior
- Click node action button → modal opens (suggest 150–200ms fade + slight scale-up, ease-out).
- Chat: Enter or Send appends user message; counselor reply arrives after a short delay (prototype uses 700ms; production = model call). Message list auto-scrolls to bottom (set `scrollTop`, not `scrollIntoView`).
- "Draft my goal" → switches modal to review view; node state → `drafted`.
- "Ask for changes" → back to chat view (state → `in progress`), counselor prompts for what to change.
- "Authorize" → state → `authorized`, modal closes, journey card shows the distilled goal, downstream nodes unlock (Role models → `available`), progress bar/count update.
- "← Journey" closes the modal at any time; conversation state persists (card shows Resume). Persist after every user turn.
- Redo on an authorized node reopens the same conversation (append, never wipe) and re-running produces a proposal against the current artifact, never a silent overwrite.
- Transparency toggle expands/collapses in place (arrow ▸/▾).
- Responsive: <~700px the modal becomes a full-screen sheet; journey becomes a single-column list.

## State Management
Per node: `status` (`planned|available|inprogress|drafted|authorized|stale`), `messages[]` (persisted every turn), `draft` (text + verbatim spans + verification result), `artifact` (authorized content), `edited` flag.
Global: dependency graph — authorization propagates availability downstream; re-authorization marks dependents `stale` (goal edits stale derived nodes but never recorded interviews). Modal state: `openNodeId`, `view` (`chat|review`), `transparencyOpen`, `editing`.
Verbatim verification runs **outside the model** in code: every marked span must be an exact substring of the transcript/upstream artifacts; one retry with violations fed back, then flag the draft.

## Assets
None — no images or icons beyond the "◎" glyph (transparency) and text arrows. Fonts from Google Fonts: Lora (500/600), Karla (400/500/600).

## Files
- `Career Journey.dc.html` — design canvas. Turn 3 / `#3a` = interactive spec (journey + working Goal node, full loop). Turn 2 = static desktop modal (`#2a`), mobile sheet (`#2b`), review state (`#2c`). Turn 1 = earlier explorations (kept for context; 1b was the chosen direction).
