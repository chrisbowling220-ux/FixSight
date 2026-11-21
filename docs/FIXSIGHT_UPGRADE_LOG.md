# Upgrade log — 2026-11-12

Working branch: `codex/fixsight-full-upgrade`; initial checkout was clean on `main`. No deployment or paid provider calls.

- Removed deceptive simulated sensing modes from web capture and added a visible limitation statement. Original photo only is sent. Unverified in browser.
- Omitted optional category from the web request when none is selected. Unverified in browser.
- Added mobile parsing and display for `next_measurement`, retaining compatibility with old saved results without that field. Backend-to-mobile contract fixture passes; mobile device/build verification outstanding.
- Added warnings, temporary option and materials to server share text, with integration assertions.
- No packages or paid model defaults changed. More work is needed to remove root Expo, repair the mobile lock, and upgrade safely.

Baseline: root `npm ci` succeeded with Node 20.19.2 and engine warnings; root audit reported 30 advisories. Mobile `npm ci` failed due to lock mismatch and engine warnings. Expo Doctor failed because Node is unsupported. Root `npm run check` first failed on sandbox IPC and then passed after approved access (86 tests before these changes). Final results are recorded in release readiness.

Final verification for this increment: root `npm run check` passed (typecheck, 87 tests, build); `node --check public/app.js` and `git diff --check` passed. Mobile typecheck failed with missing packages following the failed install. Expo Doctor failed on Node version. Browser/device tests, Vercel packaging, AI fixture evaluation and live provider tests were not run. No conclusion about mobile runtime behavior or clinical/technical diagnosis quality follows from the passing unit tests.

## Continuation — 2026-11-12

A workspace-local Node 22.23.5 was installed under ignored `.toolchain/`; no system Node was changed. Mobile `npm ci` succeeds after resolving npm's React DOM peer conflict by adding SDK-compatible `react-dom`, `expo-font`, and `expo-linking`. Expo 54 patch alignment and adding `expo-constants` brought Doctor to 18/18. SDK 54 mobile typecheck still fails in Expo's legacy FileSystem source with `exactOptionalPropertyTypes`. Root Expo was unused and removed; compatible root updates and tests reduced root audit from 30 to one high `sharp` finding. Root check passed with 88 tests after creating a generated diagnosis wire contract and drift check. Request evidence/readings contract remains separate. A backup of SDK 54 manifests is in ignored `.toolchain/rollback-sdk54-aligned/`; it is local and not a version-controlled rollback artifact.

SDK 55: `expo install` aligned native dependencies and the obsolete `newArchEnabled` config was removed, as new architecture is required. Added the missing `babel-preset-expo`, which Android bundling exposed. Mobile typecheck, Expo Doctor (20/20), Android JavaScript bundle export, and root check (88 tests) passed. No native installation or device test was run.

SDK 56: Expo's installer initially failed because npm selected incompatible Worklets 0.13.1. Expo's recommended Reanimated 4.3.1 and Worklets 0.8.3 were installed and `npm ls` showed a consistent peer tree. Mobile typecheck passed. Further Doctor and Android export checks are required; SDK 56 is not yet verified. The canonical request and response validators now generate mobile copies via `npm run sync:contract`; a root test checks the generated files match.

SDK 56 follow-up: clean `npm ci` and mobile typecheck passed; Expo Doctor reported 21/22 checks, with the known Hermes V1 memory regression and a recommendation to upgrade to SDK 57. The Android export was interrupted after failing to complete in the available verification window, so bundle behavior is not established. This intermediate release must not be shipped.

SDK 57: clean install, mobile typecheck, 21/21 Doctor checks, Android JavaScript bundle export and root check (88 tests) passed. SDK 58: the incremental installer encountered an old Router peer conflict; the SDK 57 installation and lockfile were preserved locally, and a fresh SDK 58 lock was generated. React types were aligned and tab icon colors adapted to React Native 0.88. SDK 58 clean install, typecheck, 20/20 Doctor and one-worker Android export passed. Device builds and functional tests were not performed. SDK 58 mobile audit reports three moderate findings; root audit reports one high sharp finding.

Web read-aloud controls and browser print/save-as-PDF action added. The mocked playback test passes; browser print, microphone and real provider playback were not tested. Local mock-based Vercel entry, static assets, health and API 404 smoke passed, but the Vercel platform build/packaging has not been tested. No paid calls or deployment took place.

Follow-up: web analysis now aborts after two minutes and explains that processing may continue server-side. Mobile scan requests use a deadline and support caller cancellation. Tests cover web request timeout/category handling and the mobile deadline; cancellation does not guarantee the server stopped or prevent provider billing. The final Android bundle after the mobile deadline change exported successfully. The local Vercel entry smoke used a synthetic engine and no credentials. The embedded browser surface was unavailable; no screenshot or browser interaction was verified.

Latest clean-install verification: root `npm ci` and `npm run check` passed (92 TypeScript-suite tests and 3 web mock tests, plus typecheck/build). SDK 58 mobile `npm ci`, typecheck, Expo Doctor (20/20), and Android JavaScript export passed; a later iOS JavaScript export timed out and native builds/device tests were not run. No browser surface was available for functional testing. Request timeout tests demonstrate cancellation handling but cannot guarantee the server stops or avoids billing.

The existing device-local reinspection history now shows the saved earlier photo and assessment next to the current photo, with an explicit warning that comparison does not prove improvement. It is not an automated clinical or technical change assessment. Mobile typecheck passed; real-device layout, unavailable image handling and navigation remain unverified.

Final mobile bundle retry: SDK 58 iOS JavaScript export passed after an earlier timeout; Android export passed after the reinspection change. These are not native builds or device tests.

Final root check passed: 92 TypeScript-suite tests and three web mock tests, typecheck and build. The added provider-boundary tests run 11 named synthetic categories and an insufficient-evidence response through a mocked Anthropic client with a generated blank image. They exercise validation, selected safety overrides and prompt/model metadata only; they do not evaluate model perception, diagnostic accuracy, latency or price. No live provider was called.

## Claude release-candidate session — 2026-11-21

Branch `claude/fixsight-release-candidate`, created from `codex/fixsight-full-upgrade` with the Codex working tree committed unmodified as `879a874` (also on `codex/fixsight-full-upgrade-wip-snapshot`). No deployment, no pushes, no paid AI or voice calls.

Baseline: root `npm run check` passed (92 + 3 tests); root audit 1 high (sharp).

1. **Contract v5 and prompt v5** (`13e0393`): observations separated from possible causes and limitations; repair steps, next inspection steps, cost and labor ranges with assumptions, maintenance, follow-up plan, photo requests, top-level safety notices. Photo roles/annotation flags and user measurements in requests. Prompt drops the obsolete simulated "vision mode" section. Deterministic hazard layer (`src/safety.ts`). Daily analysis cap, optional access code, opt-in refusal fallback, `max_tokens` 16,000, demo engine.
2. **Web PWA rebuild** (`e0764c4`): inspections, results, customers/jobs, PDF reports, before/after, voice, IndexedDB storage, backup, legacy migration, service worker. sharp 0.35.5 (root audit 0). Browser testing found and fixed: an invisible overlay blocking all taps, a blank page over local-network http (CSP upgrade directive), accumulating listeners, stale disabled buttons after reconnecting, unlabelled fields.
3. **Mobile and evaluation** (`a0fe6e8`): v5 result sections in the Expo app; follow-up skip loop fixed; camera plugin no longer adds microphone permissions; SDK 58 patch alignment (Doctor 20/20, typecheck, Android export). Evaluator reports latency/tokens/cost and refuses paid runs without `--confirm-paid`.
4. **Review fixes** (`bb10750`): network-first service worker, storage-full messages, unsaved photos parked as drafts.

Final verification: `npm run check` (149 tests) and `npm run test:e2e` (13 browser tests across phone, tablet, desktop, and WebKit) pass; Expo typecheck and Doctor pass. Physical devices and live AI were not tested. Details: `docs/FIXSIGHT_RELEASE_READINESS.md`.
