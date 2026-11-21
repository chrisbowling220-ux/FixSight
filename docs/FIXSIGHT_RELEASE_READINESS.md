# FixSight release readiness — release candidate (2026-11-21)

**Branch:** `claude/fixsight-release-candidate` (local only, not pushed, not deployed).
**Base:** `codex/fixsight-full-upgrade` at `81d5d7b` plus a snapshot commit of the Codex session's uncommitted work (also kept on `codex/fixsight-full-upgrade-wip-snapshot`). `main` is untouched.
**Verdict:** ready for an **approved preview deployment and a paid evaluation run**. Not yet ready for unrestricted public production: that needs the owner decisions in [Outstanding approvals](#outstanding-owner-approvals).

## 1. What was verified, and how

| Area | Evidence |
| --- | --- |
| Backend contract, safety layer, workflows, voice validation, cost guards | `npm run check`: typecheck, **149** tests, build — all pass. |
| Image handling on sharp 0.35.5 | Real decode/resize/rotate/flatten tests, corrupt and oversized (48 MP) inputs rejected. |
| Web app, all 16 requested workflows | `npm run test:e2e`: **13 browser tests, all pass**, in headless Google Chrome at phone (390×844, touch), tablet (820×1180, touch), and desktop (1366×860) sizes, plus **WebKit** (Safari's engine) at iPhone size. Uses the demo engine, so no paid calls. |
| Layout and accessibility basics | Same suite: no horizontal scrolling on any screen at any size; every button/link named; every image has alt text; every field labelled; touch targets ≥ 36 px (most 44–56 px). |
| PDF reports | Downloaded PDFs checked for a valid header and content; pages reviewed visually (branding header, client box, photos, findings, estimates, disclaimer footer, page numbers). |
| Offline | Service worker loads the app with the network off; saved inspections open; a draft made offline is analyzed after reconnecting. |
| Expo mobile app | Clean SDK 58 install, `tsc` clean, **Expo Doctor 20/20**, Android JavaScript (Hermes) bundle export succeeds. |
| Evaluation harness | Runs against the demo server; refuses to run against a paid server without `--confirm-paid` (verified with a fake key — nothing was sent). |

**Workflow coverage (your list → test):** open app and navigate (1–2) → "opens and navigates"; take/upload photo, description, submit, mocked diagnosis, follow-up questions, full diagnosis, save, reopen (3–10) → "complete inspection"; customer/job record and report export (11–12) → "customer and job records…", "share summary…"; earlier vs current photos (13) → "follow-up inspection…"; voice controls (14) → "voice: dictation…"; error and offline recovery (15) → "a server error…", "offline…", "an access-code server…"; responsive layouts (16) → "layouts fit phone, tablet, and desktop…", "Safari engine (WebKit)…". Also: legacy history migration, backup export/import.

### Not verified (be aware)

- **No physical Android, iPhone, or iPad testing.** No devices or emulators were connected to this workstation. Phone/tablet results above come from Chrome's mobile emulation and the WebKit engine, which catch most layout and logic problems but not real camera hardware, iOS permission prompts, or performance on older phones. See the device checklist in section 6.
- **No real AI analysis was run.** No paid calls were authorized, so prompt v5's diagnostic accuracy, safety sensitivity, latency, and real cost are unmeasured. All diagnostic flows were exercised with the deterministic demo engine and mocked provider responses.
- **Premium voice (ElevenLabs)** was not called live. Device-voice paths were tested with browser stubs.
- **Vercel packaging** of this branch was not deployed (needs approval).
- **Expo native builds** (APK/IPA) were not produced.

## 2. Security review

| Topic | Status |
| --- | --- |
| **Anonymous spend on a public URL** | Analysis and voice endpoints have no user login. Mitigations in this branch: per-IP rate limit (20 per 15 min), per-instance daily analysis cap (300), optional shared **access code** (`FIXSIGHT_ACCESS_CODE`), evaluator paid-run guard. **The current production deployment from `main` has none of the new guards** — see approval 2. |
| Customer data | The web app keeps inspections, photos, customers, and jobs only in the browser's storage on the user's device. `/api/analyze` is stateless: photos pass through to the AI provider and are not stored server-side. Reports are generated on the device. |
| Mobile scan API (`/api/v1/scans`) | Still dev-only: in-memory store, caller-chosen identity header. Not used by the web app. Must not hold real customer data until authentication and durable storage are approved (approval 5). |
| XSS | All web markup is produced through an auto-escaping template; tests feed hostile model text and confirm it is escaped. |
| Content Security Policy | `default-src 'self'`, no inline scripts, `frame-ancestors 'none'`. `upgrade-insecure-requests` removed: it blanked the app over http on local Wi-Fi and adds nothing for same-origin assets. |
| Untrusted images | sharp 0.35.5 (fixes the libvips/libheif/librsvg advisories), 40 MP decode limit, fail on corrupt input, 10 MB per image, 6 images per request. |
| Prompt injection | Prompt treats photo text and user text as evidence, never instructions; output is schema-constrained and validated; a deterministic hazard layer overrides DIY advice independently of the model. |
| Secrets | Keys only in server environment; never sent to the browser. `.env` is git-ignored. The access code is a shared gate, not a per-user secret. |
| Rate-limit correctness on Vercel | Requires `TRUST_PROXY=true` so limits apply per client rather than to the shared proxy address (approval 2). |
| Microphone/camera | Requested only on tap. Android `RECORD_AUDIO` and the iOS microphone prompt were removed from the Expo camera plugin (still photos only). Browser speech recognition may send audio to the browser maker's service; disclosed in Settings. |

## 3. Dependency audit (2026-11-21)

- **Root (server + web): `npm audit` — 0 vulnerabilities.** sharp 0.34 → 0.35.5 resolved the last high-severity advisory. New dev dependencies: `jspdf@4.2.1` (vendored into `public/vendor/` with its MIT license), `playwright-core@1.65.1` (tests only).
- **Expo app: 3 moderate**, all `minimatch` inside `@expo/fingerprint` (build tooling, not shipped in the app bundle). npm's only offered fix downgrades to Expo SDK 52 — not applied. Recheck on the next SDK 58 patch.
- `@anthropic-ai/sdk` stays at 0.111 (works; 1.x is a major upgrade to schedule separately).

## 4. AI model evaluation (desk review — no paid calls made)

| Model | Price (input/output per MTok) | Notes |
| --- | --- | --- |
| `claude-opus-5` (current default) | $5 / $25 | Unchanged. |
| `claude-opus-5-5` | $4 / $20 | Newer Opus, ~20% cheaper, same vision and structured-output support. Code is already compatible (adaptive thinking, explicit effort). **Recommended**, after the evaluation below. |
| `claude-sonnet-5-5` | $2 / $10 | Cheaper option worth measuring; adopt only if safety-escalation cases match Opus. |
| `claude-haiku-5-5` | $0.10 / $0.50 | Not recommended for the safety-critical judgment without strong evaluation results. |
| `claude-fable-5-2` | $8 / $40 | More expensive; not adopted (needs authorization). |

Estimated cost per analysis with the default model: about $0.10–$0.30 depending on photo count and thinking length; a follow-up-question round re-sends the photos and roughly doubles it. `max_tokens` was raised from 8,192 to 16,000 so thinking plus the larger v5 answer isn't truncated (billing follows tokens used). **To decide:** run `scripts/evaluate.ts` with licensed photos against each candidate (instructions in `evaluation/README.md`); it reports pass/fail on safety expectations, latency percentiles, tokens, and estimated cost.

## 5. Known limitations

- Data lives on one device per browser. No sync or cloud backup; clearing site data or losing the device loses it unless a backup file was exported. On iPhone/iPad, Safari may remove data for websites unused for 7 days unless FixSight is installed to the Home Screen.
- Microphone dictation, installation, and offline use need https (not available on a plain Wi-Fi `http://192.168…` address).
- Cost and labor ranges are model-generated US planning figures with stated assumptions, not quotes.
- The hazard detector is English keyword-based. It complements, never replaces, the model and a professional.
- PDF text uses the standard PDF fonts (Latin-1): names in non-Latin scripts are dropped from PDFs (shown correctly in the app).
- The Expo app shows the new result details but does not have jobs, reports, or offline drafts; the web app is the recommended client on phones and tablets today.
- Blur detection warns but never blocks; a sharp photo of a very plain surface can be flagged.

## 6. Physical device checklist (do this once on real hardware)

On an iPhone, an iPad, and an Android phone, using the https preview deployment:
1. Take a photo with the camera button (rear camera opens), and choose from the library.
2. Run an analysis (demo or real) and answer the questions.
3. Mark a problem on a photo with your finger.
4. Tap the microphone, allow access, dictate; tap Read aloud.
5. Download a PDF and open it; Share summary.
6. Install to the Home Screen; turn on airplane mode; reopen the app and open a saved inspection.
7. Rotate the tablet; check the side navigation layout.

## 7. Deployment (requires approval — nothing here has been run)

1. Push the branch and open a pull request to `main`: `git push -u origin claude/fixsight-release-candidate`. If the Vercel Git integration is on, this creates a **preview deployment**, which may use the project's preview environment variables (including paid keys) — confirm those first.
2. In Vercel project settings, set for Preview and Production: `ANTHROPIC_API_KEY`, `TRUST_PROXY=true`, `FIXSIGHT_ACCESS_CODE=<chosen code>`, optionally `ANALYSIS_DAILY_CAP`, `RATE_LIMIT_MAX`, `ELEVENLABS_API_KEY`. Do **not** set `FIXSIGHT_DEMO_MODE` in production. Optionally set a preview to demo mode for safe demos.
3. Set monthly spend limits on the Anthropic and ElevenLabs accounts.
4. Run the physical device checklist on the preview URL.
5. Merge the pull request to deploy production; confirm `/api/health` shows `prompt_v5` and `demo_mode: false`.

## 8. Backups and rollback

- **Code:** `main` remains at `81d5d7b`. Roll back production with Vercel's "Instant Rollback" to the previous deployment, or `git revert` the merge commit. Each change on this branch is a separate commit and can be reverted individually.
- **Codex work:** preserved unmodified in commit `879a874` and branch `codex/fixsight-full-upgrade-wip-snapshot`.
- **User data:** device-local. The web app's first run copies the old browser history into the new storage and leaves the old copy in place, so rolling back to the previous app still shows pre-upgrade history (inspections made after the upgrade would not appear there). Users can export a backup file from Settings at any time and import it later.
- **No server data migrations** were performed; there is no server database.

## Outstanding owner approvals

1. **Deploy** — push the branch for a Vercel preview, then merge for production.
2. **Production cost and abuse settings** — set `FIXSIGHT_ACCESS_CODE` and `TRUST_PROXY=true`, and provider spend limits. Consider applying the access code to the current production deployment now; its paid endpoints are open.
3. **Paid evaluation** — a small budgeted run with licensed photos (for example 20–30 cases, under $10) to validate prompt v5 and choose between Opus 5 and Opus 5.5.
4. **Refusal fallback** — one test call, then enable `FIXSIGHT_REFUSAL_FALLBACK_MODEL=claude-opus-4-8` if it works.
5. **Accounts and cloud storage** — if inspections must sync across devices or staff, choose an identity provider and a database/object store (costs and privacy terms differ); the design proposal from the Codex audit still applies.
6. **Native app release** — Expo/EAS build account, Apple and Google developer accounts, store listings.
7. **Brand voice** — pick the ElevenLabs voice (`ELEVENLABS_VOICE_ID`) if premium voice is used.
8. **Legal** — privacy policy and terms covering photos sent to the AI provider and customer details stored on devices; review of the safety disclaimers.
