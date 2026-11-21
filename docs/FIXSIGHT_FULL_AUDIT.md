# FixSight audit — working notes, 2026-11-12

This is a partial audit, not a release certification. Scope still outstanding includes hands-on browser and native device flows, complete dependency analysis, Vercel packaging verification, and the requested full AI safety evaluation.

## Architecture and drift

`src/server.ts` runs an Express app (`src/app.ts`); `api/index.js` wraps the compiled app for Vercel. `public/` is the web client; `apps/mobile/` is an Expo Router client with SQLite local history. The backend offers stateless `/api/analyze`, scan workflow endpoints in `src/scans/`, and ElevenLabs proxy endpoints in `src/voice/`. The backend accepts multiple visible images and labeled thermal/cavity evidence and manual instrument readings. It validates model JSON, applies safety overrides, and stores model/prompt metadata in server scan records. `docs/TECHNICAL_PLAN.md` and `README.md` describe older architecture and must be reconciled; they are not a reliable inventory of current implementation.

## Confirmed findings

- **Critical — no production authentication:** `src/auth.ts`, `src/app.ts`, `apps/mobile/src/lib/auth.ts`: the caller can choose the identity header and IP fallback is not proof of identity. Repository scoping tests do not authenticate anyone. Paid analysis and voice endpoints are also unauthenticated. Do not expose real customer data or provider keys through a public deployment until the owner approves a production auth and abuse-control design.
- **Critical — volatile history:** `src/app.ts` creates `InMemoryScanRepository`; restart, instance changes and eviction lose scan records. Refinement can fail on a different serverless instance. Mobile SQLite and browser localStorage are device-local, not backups.
- **High — dependency advisories:** root `npm audit` reports 30 vulnerabilities (1 low, 12 moderate, 15 high, 2 critical). Investigate affected paths and exploitability individually; a count does not establish production exploitability. Root Expo is unused by server imports and greatly expands dependencies; remove only after lockfile and build validation.
- **High — false physical sensing claims:** `public/index.html`, `public/app.js` presented color/edge filters as heat, wet and X-ray modes and sent the altered image to the model. Removed in this branch; browser interaction remains unverified.
- **High — mobile valid diagnosis rejection:** strict `apps/mobile/src/lib/contract.ts` omitted backend `next_measurement`, causing valid responses to fail validation and saved rows to be skipped. Schema patched and backend-to-mobile fixture added; device test remains outstanding.
- **High — optional web category rejected:** `public/app.js` sent `category: null` while `src/request-schema.ts` accepts an optional string; omit it when unselected. Browser flow remains unverified.
- **High — report safety omission:** `src/scans/report.ts` share text omitted safety warnings and temporary guidance despite containing a full structured assessment. Added those fields and materials, with integration assertions.
- **High — mobile installation and toolchain:** mobile `npm ci` fails with an out-of-sync lockfile (missing expo-font, expo-linking, react-dom, scheduler). Node 20.19.2 is below React Native 0.81's 20.19.4 minimum and Expo 58's 22.13 minimum. Doctor cannot run successfully under this runtime.
- **Medium — contract drift remains:** mobile request contract omits evidence/readings; the response is still duplicated, and the new regression is not a shared schema or exhaustive compatibility test. Extract or generate a portable shared contract and test all result variants after the mobile environment is repaired.
- **Medium — no explicit client request deadline:** `public/app.js`, `apps/mobile/src/lib/api.ts` can wait indefinitely for network requests. Add bounded cancellation and preserve answers for safe retries; avoid duplicate paid calls.
- **Medium — incomplete reports and features:** server report is structured JSON/text, not a printable PDF with images. Job records, secure export, voice playback, native voice, true reinspection comparisons, and hardware evidence input UI remain incomplete or unverified.
- **Medium — docs/operations:** `README.md` says `npm start` immediately after install although `start` needs compiled `dist`; its project map and cost figures are stale. Vercel function imports `dist` and includes `public/**`; real packaging/build and rewrites need a deployment-preview test without production deployment.

## Proposed approval-gated architecture

Use a managed identity provider and verify server-side sessions or tokens; derive immutable user IDs only from verified credentials. Require ownership checks for every scan, image, report, job and reinspection. Tests should cover forged headers, missing/expired credentials, cross-user IDs and signed URL expiry. Choose provider and deployment configuration with the owner before changing security behavior.

Implement the existing `ScanRepository` over a durable transactional database; use private object storage for images with per-user authorization, explicit retention/deletion and short-lived access. Refinement claims need atomic database transitions and recoverable leases. Document migration, backups, ownership, operating cost, deletion and rollback before provisioning or moving data. Never use public report URLs by default. The current in-memory implementation is suitable only for development.

## Technology evaluation

[Expo's upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) recommends one SDK at a time. [SDK 58](https://expo.dev/changelog/sdk-58) requires Node 22.13+ on the 22 line, 24.3+ on 24, or 26+. Upgrade through 55–58 with compatible package sets, doctor, native builds and device tests; do not simply bump package versions. Root Expo 57 appears unrelated to the Express server and should not dictate mobile SDK resolution.

[Anthropic's Opus 5.5 migration notes](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) describe vision support and behavior changes. No comparative diagnostic accuracy, latency or cost evaluation was run and the default model was not changed. [ElevenLabs TTS](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) and [STT](https://elevenlabs.io/docs/overview/capabilities/speech-to-text/) remain provider features; actual integration compatibility was not verified with paid calls.

## Dependency investigation update, 2026-11-12

The 30 root audit entries were: `@expo/cli`, `@expo/code-signing-certificates`, `@expo/config`, `@expo/config-plugins`, `@expo/fingerprint`, `@expo/metro-config`, `@xmldom/xmldom`, `baseline-browser-mapping`, `body-parser`, `brace-expansion`, `browserslist`, `compression`, `deepmerge`, `expo`, `glob`, `image-size`, `ip-address`, `js-yaml`, `minimatch`, `nanoid`, `node-forge`, `postcss`, `proxy-addr`, `qs`, `sharp`, `shell-quote`, `source-map-js`, `uuid`, `xcode`, and `zod`. Most came from the unused root Expo tree. Removing Expo from the server package reduced the root report to six entries; compatible dependency updates reduced it to one. The fixes include body-parser 2.4.0, proxy-addr 2.0.8, ip-address 10.7.6, and Zod 4.6.7. Exploitability of individual removed transitive packages was not independently proven.

The remaining high `sharp` finding covers libvips, libheif and librsvg ([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)). npm reports a fix in 0.35.5, a semver-breaking update from 0.34.x; it has not been applied or validated. Image processing handles untrusted uploads, so treat this as a release blocker. Mobile SDK 54 independently reported 35 advisories, reduced to 27 after SDK-aligned updates; reassess after each SDK migration, rather than assuming root results cover mobile.

## Continuation status

SDK 58 now installs cleanly on workspace-local Node 22, passes typecheck, 20/20 Expo Doctor checks and Android and iOS JavaScript bundle exports. SDK 56's export was not verified and has a known Hermes issue; SDK 57 passed Doctor and Android export. None of these results substitutes for native iOS/Android builds or device camera testing. The response and canonical request schemas now generate portable mobile copies, and tests check generated-file synchronization and evidence/reading compatibility. Mobile audit on SDK 58 reports three moderate entries: `expo` → `@expo/fingerprint` → `minimatch` (glob amplification). npm proposes downgrading Expo to SDK 52; do not apply that suggestion. Reassess an upstream compatible fix.

The generated Android config includes `RECORD_AUDIO` from the Expo camera plugin even though native voice capture is not implemented. Review whether this permission is needed and approve any permission change before a release. Web read-aloud controls now make a paid TTS request only on an explicit user tap; replay reuses the returned audio. Test uses a mock and no provider was called. A browser print/save-as-PDF action uses the local result view; it is not a full professional PDF or a secure customer-job export and has not been verified in a real browser.

Safety limitation: `applySafetyRules` in `src/diagnosis-contract.ts` adds strong overrides when the model labels a case with certain professional types or urgent severity. It cannot independently recognize every electrical, gas, or structural hazard if the model misclassifies it. The existing mocked tests do not establish model sensitivity or accuracy. A curated hazard corpus and independent safety review are necessary before any production claim.

The mobile history screen can now present an earlier locally linked scan and current photo for human comparison. This does not establish progress, compare unseen damage, or replace device testing. Existing SQLite remains device-local and may lose image access if a file copy fails; cloud durability and ownership remain release blockers.

The mocked provider-boundary test includes 11 named repair categories and an insufficient-evidence response. The provider responses are synthetic, and the same blank generated image is used for all categories. Passing it does not establish model performance or replace a licensed photo corpus.

## Status update — 2026-11-21 (Claude release-candidate branch)

| Finding | Status |
| --- | --- |
| Critical — no production authentication | **Open, mitigated.** Web data is now device-local and `/api/analyze` stateless, so no customer data is held server-side by the web app. Paid endpoints gain an optional shared access code, a daily cap, and the existing rate limit. Real accounts remain an owner decision. |
| Critical — volatile history | **Mitigated for the web app** (IndexedDB on device plus backup export/import). The mobile scan API repository is still in-memory and dev-only. |
| High — dependency advisories | **Resolved for root** (sharp 0.35.5, audit 0). Mobile: 3 moderate in build tooling, upstream fix pending. |
| High — false sensing claims | **Resolved.** Removed from the UI by Codex; prompt v5 now also drops the vision-mode instructions and forbids invented measurements. |
| High — mobile diagnosis rejection | **Resolved** via the tolerant stored-record schema and legacy upgrader shared with the server contract. |
| High — optional web category | **Resolved and browser-tested.** |
| High — report safety omission | **Resolved** (share text and PDFs lead with safety notices and warnings). |
| High — mobile install/toolchain | **Resolved** (SDK 58, Node 22, Doctor 20/20). |
| Medium — contract drift | **Resolved** (generated mobile copies, synchronization test). |
| Medium — no client deadline | **Resolved** (web 150 s with saved draft on timeout; mobile deadline). |
| Medium — incomplete reports and features | **Largely resolved on web:** PDF reports, jobs, before/after, voice playback. Native voice and Expo jobs/reports remain open. |
| Medium — docs/operations | **Resolved:** README and release readiness rewritten; Vercel packaging still needs a preview deploy. |

New findings fixed in this session: Helmet's `upgrade-insecure-requests` blanked the app over local-network http (affects every phone/tablet test); a hidden loading overlay blocked all input; the mobile follow-up "Skip" looped back to the same questions; the low-confidence measurement rule rejected correct professional-only hazard answers; the demo/keyword hazard false positives were bounded by tests.
