# FixSight

Photograph a visible repair problem and get a cautious, evidence-based first look: what the photos actually show, possible causes (clearly marked as unconfirmed), safety concerns, severity and urgency, DIY-or-professional advice, step-by-step repair instructions, tools and materials, and rough cost and labor ranges with their assumptions. Keep inspections organized by customer and job, compare before and after, and hand over a professional PDF report.

FixSight is a photo-based first opinion. It cannot see inside walls, measure moisture or temperature, detect gas, or confirm structural safety, and it never replaces an on-site professional. Electrical, gas, and structural hazards are always routed to a licensed professional.

> **Status:** release candidate on branch `claude/fixsight-release-candidate`, not deployed. See [release readiness](docs/FIXSIGHT_RELEASE_READINESS.md) for what is verified, what is not, and what needs your approval. To go live at fixsight.contractor-office.com, follow the [launch plan](docs/FIXSIGHT_LAUNCH_PLAN.md).

## Quick start (about 5 minutes)

1. Install **Node.js 22 LTS** from https://nodejs.org (any 22.x from 22.13 on, or 24.x).
2. Open a terminal in this folder and run:

   ```sh
   npm ci
   npm run demo
   ```

3. Open **http://localhost:3000** in your browser.

`npm run demo` uses built-in sample results, so everything works without an AI key and costs nothing. A yellow banner reminds you the results are samples.

To use real AI analysis, copy `.env.example` to `.env`, paste your Anthropic key after `ANTHROPIC_API_KEY=`, and run `npm run dev` instead. Each analysis is a paid API call (roughly $0.10–$0.30 with the default model; a follow-up-question round roughly doubles it).

## Open it on your phone or tablet

1. Keep `npm run demo` (or `npm run dev`) running on your computer.
2. Connect the phone or tablet to the **same Wi-Fi** as the computer.
3. Look in the terminal for the line **"On a phone or tablet on the same Wi-Fi: http://192.168.x.x:3000"** and type that address into the phone's browser (Safari on iPhone/iPad, Chrome on Android).
4. If nothing loads, allow Node.js through your computer's firewall for private networks and try again.

Over that Wi-Fi address you can take photos, run analyses, keep history, manage jobs, and download PDF reports. Three features need a secure **https** address, which a plain Wi-Fi address isn't: microphone dictation, "Add to Home Screen" installation, and offline use. Those work on the deployed https version (needs your approval to deploy) or on `http://localhost:3000` on the computer itself.

**iPhone/iPad tip:** once you use the https version, install it (Share → Add to Home Screen). Safari can delete website data that hasn't been used for 7 days unless the app is installed. Export a backup from Settings regularly either way.

## What's included

- **Inspect:** up to four photos (wide shot + close-up guidance), automatic blur/dark/glare warnings, draw on a photo to mark the problem, category, description with dictation, measurements you took (FixSight never guesses sizes from photos), and linking to a job. Works offline as a draft and analyzes when you're back online.
- **Results:** safety notices first; observations vs. possible causes vs. limitations; severity, urgency, confidence; DIY or professional with the reason; repair steps and a materials checklist you can tick off; next things to check; cost and labor ranges with assumptions; maintenance; follow-up timing; and requests for better photos when needed. Follow-up questions are asked when the answer would change the advice.
- **Jobs & customers:** customer profiles, property address, job status and progress log, linked inspections, search.
- **Reports:** PDF for one inspection or a whole job with your business name, logo, and license number; share or copy a summary; print.
- **Before & after:** follow-up inspections with a framing guide, a swipe comparison, and repair-progress photos.
- **Voice:** read results aloud with the device's free voice (premium ElevenLabs voice optional), dictation, and a hands-free step-by-step mode with "next / back / repeat" voice commands.
- **Your data stays on your device** (browser storage), with backup export/import. Nothing is synced to a cloud.

## Configuration

All settings are environment variables; see `.env.example` for the full list. The important ones:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables real AI analysis (paid). |
| `FIXSIGHT_MODEL` | Model, default `claude-opus-5`. `claude-opus-5-5` is newer and cheaper; switch after evaluating. |
| `FIXSIGHT_ACCESS_CODE` | Shared code required for analysis/voice. Set this on any public URL. |
| `ANALYSIS_DAILY_CAP` | Daily backstop on paid analyses per server instance (default 300). |
| `TRUST_PROXY` | `true` on Vercel so rate limits see real client IPs. |
| `ELEVENLABS_API_KEY` | Optional premium voice. |
| `FIXSIGHT_DEMO_MODE` | `true` for sample results (what `npm run demo` sets). |

## Commands

| Command | What it does |
| --- | --- |
| `npm run demo` | Run with sample results (free). |
| `npm run dev` | Run with real AI (needs `.env`). Restarts on code changes. |
| `npm run check` | Typecheck, unit/integration tests, build. |
| `npm run test:e2e` | Browser tests of every workflow (needs Google Chrome; set `CHROME_PATH` if it's elsewhere). |
| `npm run build` then `npm start` | Compiled production server. |
| `npx tsx scripts/evaluate.ts <cases.json>` | Accuracy/latency/cost evaluation; refuses paid runs without `--confirm-paid`. |
| `npm run sync:contract` | Regenerate the mobile copies of the shared request/response contract. |

## Project layout

- `src/` — Express server: request validation, diagnosis engine and prompt (`prompt.ts`), response contract (`diagnosis-wire.ts`), the deterministic safety layer (`safety.ts`), demo engine, cost guards, scan workflow, and ElevenLabs voice proxy.
- `public/` — the web app (installable PWA): `js/` modules, `sw.js` service worker, vendored jsPDF in `vendor/`.
- `apps/mobile/` — Expo (React Native) app with device-local SQLite history. The web app is the recommended client on phones and tablets today; the Expo app needs native builds and device testing before release.
- `api/index.js`, `vercel.json` — Vercel serverless entry.
- `test/` — unit, integration, and browser (`test/e2e/`) tests. `evaluation/` — photo evaluation harness.
- `docs/` — release readiness, audit, upgrade log, voice notes, and the evidence schema.

### Expo mobile app (optional)

```sh
cd apps/mobile
npm ci
npm run typecheck
npx expo-doctor@latest
EXPO_PUBLIC_API_BASE_URL=http://<your-computer's-Wi-Fi-IP>:3000 npm start
```

Scan the QR code with Expo Go. `localhost` on a phone means the phone itself, so use the computer's Wi-Fi address. Native store builds and on-device camera testing are still outstanding.
