# FixSight

FixSight offers an AI-assisted first look at visible repair problems. A photo can suggest possible causes and safety concerns; it cannot confirm a diagnosis, inspect concealed conditions, or replace an on-site professional.

**Development only:** the current server uses a development identity and process-local scan storage. It is not suitable for customer data or a public production deployment. See [release readiness](docs/FIXSIGHT_RELEASE_READINESS.md) and the [audit](docs/FIXSIGHT_FULL_AUDIT.md).

## Local development

Use Node 22.13 or newer on the Node 22 line (Expo SDK 58 also supports Node 24.3+ on the 24 line). From the repository root:

```sh
npm ci
npm run check
npm run dev
```

Open http://localhost:3000. Without an Anthropic key the UI and health endpoint run, but analysis is unavailable. To use a provider with authorization, copy `.env.example` to `.env` and configure the relevant key locally; do not commit it. Requests to AI and voice providers can incur charges. The model is configurable and is not changed automatically during upgrades.

For compiled server execution, run `npm run build` followed by `npm start`. The Expo app is separate:

```sh
cd apps/mobile
npm ci
npm run typecheck
npx expo-doctor@latest
npm start
```

Set `EXPO_PUBLIC_API_BASE_URL` to an accessible backend URL for a physical device; `localhost` on the device refers to the device itself. Native camera and microphone permissions, device connectivity, offline behavior and iOS/Android builds require device-specific verification.

## Layout

- `src/`: Express application, validated diagnosis engine, scan workflow, and voice proxy.
- `public/`: mobile-first web client with browser-local history.
- `apps/mobile/`: Expo Router app and device-local SQLite history.
- `api/index.js` and `vercel.json`: serverless entry and routing configuration.
- `test/` and `evaluation/`: automated tests and photo-evaluation harness.

Run `npm run sync:contract` after changing `src/diagnosis-wire.ts` or `src/request-wire.ts`; the test suite checks the generated mobile copies. The server-side repository is volatile and the device header is not authentication. Do not use either as a production security boundary.
