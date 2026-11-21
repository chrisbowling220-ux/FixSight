# Release readiness — NOT READY

Do not deploy this branch or use it for customer information. Authentication, durable private storage, deployment verification and mobile validation remain open. This work is a partial audit and development increment, not a completed modernization.

## Local development

With a compatible Node installation, from the repository root:

```sh
npm ci
npm run check
npm run dev
```

Open `http://localhost:3000`. Without an Anthropic key the server starts but analysis is unavailable. For live provider use only with authorization, copy `.env.example` to `.env` and configure secrets locally; never commit them. `npm run build` followed by `npm start` runs compiled output. Mobile requires Node 22.13+ (Node 22.23.5 was used here). Run `cd apps/mobile && npm ci && npm run typecheck && npx expo-doctor@latest && npm start`. The workspace-local Node executable used here is `.toolchain/bin/node` and is intentionally not version-controlled. Set `EXPO_PUBLIC_API_BASE_URL` to a reachable backend for physical devices; localhost on a phone is the phone itself.

## Verification and outstanding work

See the upgrade log and audit for baseline failures. The root mocked test suite covers schema, scan workflows and voice validation; it does not establish actual model diagnostic quality or device behavior. Re-run `npm run check`, `npm audit`, mobile clean install/typecheck/doctor, mock evaluation, browser capture/follow-up/history and Android/iOS device tests before release. Obtain a licensed synthetic/real test corpus; `evaluation/cases.example.json` uses placeholder images and the evaluator calls a configured server, potentially incurring charges. Validate Vercel build output and routes in a non-production preview without customer data.

Before production: owner must review and approve authentication, per-user ownership, private durable storage and retention/deletion; implement and test them. Resolve dependency advisories and compatible Node/Expo upgrades. Validate model and prompt using safety, accuracy, latency and cost fixtures; obtain approval before changing the paid default. Verify secrets and rate limits without exposing them; document monitoring, provider budgets and response to abuse. Complete accessibility, privacy, security and release review. Configure production only with explicit owner approval.

## Rollback

Keep `main` unchanged and retain its commit as the rollback reference. Revert the individual development commits or deploy a previously verified artifact using the normal approved release process; do not reset databases or force-push. No migration or production configuration was performed by this work. Back up and rehearse any future data migration separately before rollout.

Verification for this development increment: root `npm run check` passed (87 tests and build); web JavaScript syntax and `git diff --check` passed. SDK 58 mobile clean install, typecheck, Expo Doctor (20/20) and Android JavaScript export passed; an iOS JavaScript export also passed on retry; native builds and device tests were not run. A local synthetic HTTP smoke test of the Vercel entry, assets, health and API 404 passed; actual Vercel packaging and rewrites remain unverified. Browser functional tests and AI evaluation were not run.

## Owner review proposals

1. **Identity and authorization:** select an identity provider and deployment environment; verify signed session tokens server-side and derive ownership from verified subject IDs. Require per-user checks on scans, jobs, reports and images; reject forged development headers. Cover anonymous requests, expiration, cross-user access, object URLs and rate-limit bypasses in integration tests. Decide account recovery, revocation and migration of device-only history before applying changes.
2. **Durable storage:** evaluate a transactional relational database plus private object storage against expected scan volume, region, retention and monthly costs. Preserve the repository interface; use a transaction or lease for refinement claims and private expiring image access. Establish backup, restore, deletion, access logging, and migration/rollback before provisioning. Do not migrate or discard current device history without an explicit plan.
3. **Customer jobs and sharing:** customer names, notes and photos require the approved ownership, privacy, retention and deletion design before multi-device or cloud use. Browser printing is local and user initiated; it is not the requested complete, secure customer-job PDF workflow.
4. **Permissions and provider costs:** review the Android `RECORD_AUDIO` permission introduced by the camera plugin and approve any change. Approve budgets and a controlled test plan before live AI/voice evaluation or changing the configured paid model. Reassess the remaining `sharp` and Expo fingerprint dependency findings before deployment.

Latest clean-install verification: root `npm ci` and `npm run check` passed (92 TypeScript-suite tests and three web mock tests). SDK 58 mobile clean install, typecheck, Expo Doctor and Android JavaScript export passed. An initial iOS export timed out, then the JavaScript export passed on retry; native builds and real device checks remain outstanding. Browser print and playback controls have not been verified in a real browser. Web and mobile request deadlines do not ensure cancellation of an in-flight provider call.

The reinspection view uses existing device-local links and provides no automated improvement score. Verify navigation, image persistence, accessibility and missing-photo behavior on both supported mobile platforms. Customer/job records, secure export, full PDF reports, native voice and comprehensive AI fixtures remain incomplete.
