# App Store Compliance Audit — Final Report

## 1. Verdict

**Not submittable as-is.** Four blockers: the only build path produces an icon-less binary that fails upload validation; the shipped app is a permanently locked "mock" demo with no path to real functionality; there is no privacy policy; and the privacy nutrition labels cannot yet be answered truthfully. The mock-only state alone guarantees rejection under 2.1/2.2/4.2.

**Shortest path to submittable:** (a) decide the product state — restore key-entry UI + capped review key (recommended) OR productize the keyless mode and delete all "mock/no key" language; (b) archive Release on GM Xcode without the `EXCLUDED_SOURCE_FILE_NAMES="Assets.xcassets"` override and verify Assets.car + CFBundleIconName; (c) write/host a privacy policy and fill the labels (Other User Content + Audio, app functionality, not linked, no tracking); (d) add a first-run disclosure/consent screen (AI interviewer, third-party AI recipients, not therapy) — this one screen discharges three separate risks; (e) rename or disclaim "Career Counseling"; (f) scope to iPhone-only portrait for v1. Roughly 2–4 focused days plus policy hosting.

## 2. Findings (deduplicated)

### BLOCKERS

**B1 — Icon-less binary fails upload (2.1 / ITMS-90022).** Both build scripts pass `EXCLUDED_SOURCE_FILE_NAMES="Assets.xcassets"` (scripts/run-ios-sim.sh:21, run-ios-device.sh:28) due to broken actool on the beta toolchain; no Release/archive script exists, so any archive ships without Assets.car/CFBundleIconName.
*Fix:* Archive on GM Xcode without the exclusion; verify `plutil -p App.app/Info.plist | grep Icon` shows CFBundleIconName=AppIcon and Assets.car exists.

**B2 — Reviewer sees only a scripted, non-persistent mock; no way to unlock the real product (2.1 / 2.2 / 4.2 / 1.1.6).** *[merges 3 findings across domains]* Key-entry UI removed; `M.mock = !ctx.journey.ai` (public/braid-mobile.js:951) forces mock for every keyless install, banner says "Mock interview — no key configured, nothing is saved" (i18n.js:92), mock progress vanishes on relaunch (braid-mobile.js:749-757), and error strings still point at removed UI ("add a key in settings", src/mobile-main.ts:264,377,423).
*Fix:* Either restore key-entry UI (vendor/Preferences plumbing intact) + capped review key in Review notes, or ship the keyless mode as the real product: persist it, rename "mock", delete all "no key/settings" strings; rebuild mobile/www and ios/App/App/public.

**B3 — No privacy policy exists (5.1.1(i)).** Repo contains no policy or URL, yet the app POSTs full interview content to OpenRouter (src/llm.ts:185-193) and streams mic PCM to OpenAI realtime (src/mobile-main.ts:431-434).
*Fix:* Write and host a policy covering: recipients (OpenRouter → allowlisted ZDR hosts; OpenAI), retention (ZDR pinning vs OpenRouter metadata logs and OpenAI 30-day abuse retention), no developer server, on-device storage + in-app deletion, no analytics/accounts/tracking. Enter URL in App Store Connect.

**B4 — Privacy labels must declare collection; "Data Not Collected" is a misdeclaration (5.1.1/5.1.2/2.3.1).** Transmission to third parties is the app's primary function; ephemeral-processing carve-out doesn't apply (OpenAI 30-day retention; ZDR ≠ non-access).
*Fix:* Declare "Other User-Generated Content" + "Audio Data", App Functionality, not linked to identity, not used for tracking. Note in Review notes that 5.1.1(v) account deletion is N/A (no accounts).

### RISKS

**R1 — Name "Career Counseling" claims a professional service and duplicates the Savickas/APA book title (5.1.1(ix) / 1.1.6 / 2.3.7 / 5.2.1).** *[merges 2 findings + EULA-disclaimer advisory]* CFBundleDisplayName in Info.plist:9-10; no "not therapy" disclaimer anywhere user-facing; generic two-word name likely non-unique in App Store Connect.
*Fix:* Rename to a distinctive non-service name (e.g. "Career Construction", "Life Portrait"); add first-run + description disclaimer (self-guided reflection based on Savickas 2019, independent, not therapy/professional counseling); never use "Savickas"/APA marks in metadata.

**R2 — No disclosure/consent before personal content reaches third-party AI (5.1.2(i), Nov 2025 revision names AI explicitly).** Live mode flips silently on key presence (braid-mobile.js:950-951); only the mock has provenance messaging.
*Fix:* One-time pre-first-live-session screen naming OpenRouter/OpenAI, what is sent, privacy-policy link, explicit tap to proceed; flag stored in Preferences.

**R3 — AI disclosure + age rating: cannot ship 4+ (1.2 / 2.3.6).** *[merges 3 findings]* Open-ended LLM chat about early memories/feelings, unmoderated output (src/mobile-main.ts:394-407), interviewer never labeled as AI in mobile UI (i18n.js:82-99), no report mechanism.
*Fix:* Add "this is an AI and may make mistakes" to the first-run notice + session header; answer AI-chat and sensitive-theme questionnaire questions honestly; target 16+ (13+ floor); cite guardrail architecture in Review notes; consider a report/flag affordance.

**R4 — Crisis handling is model-generated and inconsistent (1.2).** Self-harm guardrail exists in only 2 of 6 playbooks; "provide crisis resources" lets the model hallucinate hotline numbers; no static resource list, no deterministic interception.
*Fix:* Ship a static, localized crisis-resource card rendered by the app; hoist the guardrail into `interviewerSystem()` (src/engine.ts:66-92) for all stages; change instruction to "direct user to the app's crisis resources."

**R5 — iPad + all orientations declared but untested (2.4.1).** TARGETED_DEVICE_FAMILY="1,2" (pbxproj:288,309), all iPad orientations, no UIRequiresFullScreen — Apple will review on iPad in Split View against a phone-designed UI.
*Fix:* Low-risk path: TARGETED_DEVICE_FAMILY=1, portrait-only, for v1. Otherwise test/fix iPad + landscape.

**R6 — BYOK must be framed under 3.1.3(f), with zero purchase CTAs (3.1.1).** 3.1.3(b) is the wrong clause (invites IAP-parity demand); current bundle is clean of provider signup links.
*Fix:* When restoring key entry: neutral "API key" label, no links to provider signup/pricing, Review notes cite 3.1.3(f) + include a capped, revocable review key.

**R7 — Dormant invite-code/key-vendor plumbing still wired into the iOS build (3.1.1 / 2.3.1).** `VENDOR_URL` in SETTING_KEYS (src/mobile-main.ts:76) and build define (scripts/build-mobile.sh:14-18); paid invite codes would be a textbook IAP bypass.
*Fix:* Strip VENDOR_URL from the iOS build entirely; keep vendor desktop-only; never sell codes without switching to IAP and trader status.

### ADVISORIES

**A1 — Encryption declaration missing (2.5/export).** Only platform TLS used. *Fix:* Add `ITSAppUsesNonExemptEncryption=false` to Info.plist.

**A2 — Bundle ID `app.careercounseling.local` is permanent after first upload.** `.local` is mDNS-reserved and reads as a placeholder (pbxproj:284,305; capacitor.config.json). *Fix:* Switch to a conventional ID in pbxproj (both configs), capacitor.config.json, both run scripts — before creating the App Store Connect record.

**A3 — Leftover Cordova config.xml with `<access origin="*"/>` ships in the bundle.** Unused by Capacitor 8. *Fix:* Delete ios/App/App/config.xml + its 4 pbxproj references.

**A4 — UIRequiredDeviceCapabilities requires armv7 (impossible at iOS 15 target).** Can never be narrowed post-release. *Fix:* Replace with arm64 or delete the key (Info.plist:31-34).

**A5 — API keys in UserDefaults, not Keychain (5.1.1 security).** Real billing credentials in an unencrypted, backed-up plist (src/mobile-main.ts:75-91). *Fix:* Move secret keys to Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) when key UI returns.

**A6 — Transcripts/artifacts are plaintext JSON with default file protection, included in backups (5.1.1(ii)).** No entitlements file at all. *Fix:* Add Data Protection capability (NSFileProtectionComplete); disclose backup inclusion in the policy; surface the existing /api/reset delete-everything plumbing.

**A7 — No app-level PrivacyInfo.xcprivacy (5.1.1).** Likely passes validation today (frameworks carry their own), but should mirror the labels. *Fix:* Add one declaring NSPrivacyTracking=false + collected data types matching B4.

**A8 — Privacy copy accuracy (5.1.2/2.3.1).** Current in-app claims verified accurate; mic string's "you configured" is stale; "zero data retention" would over-claim in marketing. *Fix:* Reword mic string to name OpenAI concretely; never claim "nothing leaves your device"; if voice stays unreachable on iOS, drop NSMicrophoneUsageDescription.

**A9 — OFL fonts (Karla, Manrope, Lora) ship without license text/copyright notices (5.2.2/OFL-1.1).** *Fix:* Bundle OFL.txt + per-family notices; add a small in-app Licenses screen (include the app's MIT notice).

**A10 — EU DSA trader declaration required before EU distribution.** Truthfully non-trader as built; selling invite codes would flip it. *Fix:* Complete the declaration as non-trader in App Store Connect; document that monetizing keys requires trader status first.

**A11 — Verified clean (no action):** launch screen (UILaunchScreen dict), mic purpose string present, full default ATS with all-TLS endpoints, deployment target 15.0 consistent, 2.5.2 satisfied (all JS bundled, no remote code).

## 3. Remediation checklist (dependency order)

1. **Decide product state** — key-entry UI vs. keyless-as-product (B2). Gates items 2, 12–14. — **S** (decision) 
2. Implement chosen state: restore key UI or productize keyless; delete/reword "mock" and "add a key in settings" strings (src/mobile-main.ts:264,377,423; i18n.js:92,248); rebuild bundles — **M** 
3. Strip VENDOR_URL from iOS build (R7) — **S** 
4. Rename app / pick final display name (R1) — blocks 5 and 8 — **S** 
5. Change bundle ID before any App Store Connect record exists (A2) — **S** 
6. Info.plist/pbxproj hygiene batch: ITSAppUsesNonExemptEncryption (A1), armv7→arm64 (A4), delete config.xml (A3), TARGETED_DEVICE_FAMILY=1 + portrait-only (R5), reword mic string or drop it (A8) — **S** 
7. First-run notice screen: AI interviewer + may err, data goes to OpenRouter/OpenAI, consent tap, not-therapy disclaimer, privacy-policy link (R1+R2+R3 in one screen) — **M** 
8. Write and host privacy policy; enter URL (B3) — **M** 
9. Static crisis-resource card (en/ru) + hoist guardrail into engine.ts (R4) — **M** 
10. Data Protection entitlement (A6) + app-level PrivacyInfo.xcprivacy (A7) — **S** 
11. OFL.txt + Licenses screen (A9) — **S** 
12. Keychain storage for keys — only if key UI restored (A5) — **M** 
13. Release archive script on GM Xcode without asset-catalog exclusion; verify Assets.car + CFBundleIconName (B1) — **S–M** (depends on GM availability) 
14. App Store Connect: nutrition labels (B4), age-rating questionnaire → 16+ (R3), DSA non-trader (A10), Review notes with steps + capped review key (R6) — **S** 
15. Full device pass: fresh install → consent → real interview → persistence across relaunch — **M**

## 4. Reviewer conversation prep

**Q1: "The app shows a mock/demo — where is the real functionality?"** 
A: The full AI interview is reachable via the API key field (free client for a user-provided paid web service per 3.1.3(f); no purchasing or purchase CTAs in-app). A capped, revocable review key is in the Review notes with step-by-step instructions. (If this can't be answered, do not submit.)

**Q2: "Is this a counseling/mental-health service? Who is the licensed provider?"** 
A: No service is provided. It is a self-guided reflection tool implementing a published method (Savickas, *Career Counseling*, 2nd ed., APA 2019), independent and unaffiliated. A first-run notice and the description state it is not therapy or professional counseling; a static in-app crisis-resource card covers distress scenarios.

**Q3: "Where does user data go, and why is there no account deletion?"** 
A: There are no accounts — 5.1.1(v) is N/A. Interview text goes device-to-OpenRouter (pinned to zero-data-retention hosts, `data_collection: deny`); dictation audio goes device-to-OpenAI for transcription. The developer runs no servers and never sees content. Everything else is stored on-device only and is deletable in-app. Labels declare User Content + Audio, not linked, not used for tracking; no ATT prompt is needed.

**Q4: "It's an AI chatbot discussing sensitive topics — how is that handled, and is the age rating accurate?"** 
A: Rated 16+ with AI-chat and unpredictable-content questions answered "yes." Safeguards: the interviewer is disclosed as AI up front; every stage runs a narrow system prompt with a global acute-distress/self-harm guardrail that directs users to app-rendered (not model-generated) crisis resources; artifacts require explicit user authorization; the compiled model instructions are user-inspectable in-app via the transparency panel.