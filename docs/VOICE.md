# Voice (ElevenLabs)

FixSight's voice features run through the app's own Express backend — FixSight
has its own backend rather than the shared Firebase project the other
Contractors Office apps use, so the voice endpoints live here (this is the
fallback the voice build spec describes for an app with its own backend).

**The proxy rule:** the browser never holds the ElevenLabs API key and never
calls ElevenLabs directly. Everything goes through `src/voice/`, mirroring how
`diagnosis-engine.ts` proxies Anthropic.

## Setup

Set `ELEVENLABS_API_KEY` in `.env` for local dev and in the Vercel project for
production. That's the only required step. Without it, `/api/voice/status`
reports `available: false` and the web client never shows the mic button — the
rest of FixSight is unaffected.

Optional overrides (defaults in `src/config.ts`):

| Env var | Default | Notes |
|---|---|---|
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | **Placeholder.** The one shared brand voice the whole suite speaks in — replace with the chosen ElevenLabs voice id. |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` | `scribe_v1` is deprecated. |
| `ELEVENLABS_TTS_MODEL` | `eleven_flash_v2_5` | Low-latency streaming model. |
| `ELEVENLABS_TTS_FORMAT` | `mp3_44100_128` | — |
| `VOICE_DAILY_TTS_CHARS` | `200000` | Per-instance/day runaway backstop, not a spend limit. |
| `VOICE_DAILY_STT_SECONDS` | `3600` | Same. |

## Endpoints

All under `/api/voice`, rate-limited by the same limiter as `/api/analyze`, and
— like `/api/analyze` — **no user auth**.

- `GET /status` → `{ available, sttModel, ttsModel, voiceId }`
- `POST /transcribe` → `{ audio: dataURL|base64, mimeType?, durationMs? }` → `{ transcript }`
- `POST /synthesize` → `{ text, voiceId? }` → streamed `audio/mpeg` (Feature B; endpoint built, UI not yet wired)

## Client

Feature A (voice input) is wired in `public/app.js` (`initVoice`): a mic button
on the "Anything you've noticed?" field records via `MediaRecorder`, posts to
`/transcribe`, and drops the transcript into the textarea for review. It never
auto-submits the scan.

CSP/permissions in `src/app.ts` were widened for this: `microphone=(self)` in
the permissions-policy header, and `media-src blob:` for Feature B playback.

## Not done / notes

- **Feature B** (spoken "Read it aloud" on the result screen) is the next phase.
  The `synthesize` endpoint already exists. The disclaimer rule from the spec
  must key off the diagnosis **output** fields (`needs_professional`,
  `disclaimer_required`, `safe_to_diy === false`, non-empty `safety_warnings`),
  not the input category.
- **Usage logging** (`voiceUsage` collection, `appId: "fixsight"`) from the spec
  assumes the shared Firestore project, which FixSight doesn't have. For now
  usage is a per-instance counter + a structured `console.log` line per call.
  Wiring the shared collection is deferred.
- Voice input is only offered on the **web** app (`public/`). The Expo mobile
  app (`apps/mobile`) needs a native audio approach and is not covered here.
