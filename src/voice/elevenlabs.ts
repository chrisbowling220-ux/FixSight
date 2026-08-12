/**
 * FixSight voice service — the single place every ElevenLabs call goes through.
 *
 * THE PROXY RULE (same as the Anthropic call in `diagnosis-engine.ts`): the
 * browser never holds the ElevenLabs API key and never calls ElevenLabs
 * directly. Everything runs here, on the server, which owns:
 *   - the key
 *   - the per-request limits that keep a public endpoint from becoming a bill
 *   - a coarse per-instance daily backstop against a runaway loop
 *
 * We call ElevenLabs over plain `fetch`, matching how the rest of the server
 * talks to providers — no SDK, nothing to drift between versions.
 *
 * This is the FixSight-native equivalent of the shared voice-kit functions the
 * other Contractors Office apps call: FixSight has its own Express backend
 * rather than the shared Firebase project, so the functions live here.
 */

import { FixSightError } from "../errors.js";
import type { VoiceConfig } from "../config.js";

const API_BASE = "https://api.elevenlabs.io/v1";

// ---------------------------------------------------------------------------
// Per-request limits — stateless, enforced before a single character is spent.
// ---------------------------------------------------------------------------

/** A 60s Opus clip is well under 1 MB; this is a generous ceiling on abuse. */
const MAX_AUDIO_BASE64_CHARS = 4_000_000;
/** One spoken read-aloud. Long enough for a full diagnosis, not a novel. */
const MAX_TTS_CHARS = 3_000;
/** ElevenLabs voice ids are short url-safe tokens; anything else is a probe. */
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{12,40}$/;
// The mime type may carry parameters — Chrome/Firefox record
// `audio/webm;codecs=opus`, so a data URL looks like
// `data:audio/webm;codecs=opus;base64,...`. Capture the whole media type,
// parameters included, up to the final `;base64,`.
const DATA_URL = /^data:(audio\/[a-z0-9.+-]+(?:;[a-z0-9.+=_-]+)*);base64,(.*)$/i;

class VoiceError extends FixSightError {
  constructor(message: string, status = 400, code = "invalid_voice_request") {
    super(message, status, code, true);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The upload part needs a filename whose extension matches the bytes — a Safari
 * `audio/mp4` clip sent as `clip.webm` is a mislabelled container, and the
 * transcription service is entitled to reject it. Browsers we support record
 * webm/ogg (Chrome, Firefox) or mp4 (Safari); the rest cover clips that reach
 * the endpoint from anything other than the mic button.
 */
const CLIP_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

export function clipFileName(mimeType: string): string {
  const base = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  return `clip.${CLIP_EXTENSIONS[base] ?? "webm"}`;
}

// ---------------------------------------------------------------------------
// Pure request validation — no network, no key, safe to unit test.
// ---------------------------------------------------------------------------

export interface DecodedAudio {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Accepts a base64 data URL (the same shape the photo upload uses) or a raw
 * base64 string with the mime type sent alongside, and returns the bytes.
 */
export function decodeAudio(body: unknown): DecodedAudio {
  const record = isRecord(body) ? body : {};
  const value = record.audio;
  if (typeof value !== "string" || value === "") {
    throw new VoiceError("Send an audio clip to transcribe.");
  }
  if (value.length > MAX_AUDIO_BASE64_CHARS) {
    throw new VoiceError(
      "That clip is over the size limit. Keep recordings under about a minute.",
    );
  }
  const match = DATA_URL.exec(value);
  let mimeType: string;
  let base64: string;
  if (match) {
    mimeType = match[1] ?? "audio/webm";
    base64 = match[2] ?? "";
  } else {
    // A `data:` prefix that didn't match is malformed — treating it as raw
    // base64 would silently decode the prefix as leading bytes and corrupt the
    // clip. Fail loudly instead.
    if (value.slice(0, 5).toLowerCase() === "data:") {
      throw new VoiceError("That audio clip isn't a base64 data URL we can read.");
    }
    mimeType = typeof record.mimeType === "string" ? record.mimeType : "audio/webm";
    base64 = value;
  }
  return { mimeType, buffer: Buffer.from(base64, "base64") };
}

/** Best-effort seconds for the daily backstop; never trusted for billing. */
export function clipSeconds(body: unknown): number {
  const record = isRecord(body) ? body : {};
  const ms = Number(record.durationMs ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 1000));
}

/** Validates and trims the read-aloud text, enforcing the character cap. */
export function validateTtsText(body: unknown): string {
  const text =
    isRecord(body) && typeof body.text === "string" ? body.text.trim() : "";
  if (text === "") throw new VoiceError("Nothing to say — send some text.");
  if (text.length > MAX_TTS_CHARS) {
    throw new VoiceError(
      `That is longer than the ${MAX_TTS_CHARS.toLocaleString()} character limit for one read-aloud.`,
    );
  }
  return text;
}

/** Falls back to the configured brand voice unless a valid id is requested. */
export function resolveVoiceId(body: unknown, fallback: string): string {
  const requested =
    isRecord(body) && typeof body.voiceId === "string" ? body.voiceId : "";
  return VOICE_ID_PATTERN.test(requested) ? requested : fallback;
}

// ---------------------------------------------------------------------------
// Status — the client polls this to decide whether to show voice controls.
// ---------------------------------------------------------------------------

export interface VoiceStatus {
  available: boolean;
  reason?: string;
  sttModel: string;
  ttsModel: string;
  voiceId: string;
}

// ---------------------------------------------------------------------------
// The service. One instance per process; the daily backstop counter lives in
// the closure below.
//
// Honest caveat, same as the Anthropic side: on a serverless deploy this
// counter lives in one warm instance's memory, so the real ceiling is "this
// much per instance per day", not per day. It is a runaway-loop backstop, NOT
// a spend limit — the spend limit that actually holds is the tier cap on the
// ElevenLabs account itself.
// ---------------------------------------------------------------------------

export interface VoiceService {
  status(): VoiceStatus;
  transcribe(body: unknown): Promise<{ transcript: string }>;
  synthesize(
    body: unknown,
  ): Promise<{ contentType: string; body: ReadableStream<Uint8Array> }>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createVoiceService(config: VoiceConfig): VoiceService {
  const usage = { day: today(), ttsChars: 0, sttSeconds: 0 };

  function rollUsage(): void {
    const now = today();
    if (usage.day !== now) {
      usage.day = now;
      usage.ttsChars = 0;
      usage.sttSeconds = 0;
    }
  }

  function requireKey(): string {
    if (!config.apiKey) {
      throw new VoiceError(
        "Voice is not configured on the server.",
        503,
        "voice_unavailable",
      );
    }
    return config.apiKey;
  }

  function status(): VoiceStatus {
    const available = Boolean(config.apiKey);
    return {
      available,
      ...(available ? {} : { reason: "Voice is not configured on the server." }),
      sttModel: config.sttModel,
      ttsModel: config.ttsModel,
      voiceId: config.voiceId,
    };
  }

  async function transcribe(body: unknown): Promise<{ transcript: string }> {
    const key = requireKey();
    rollUsage();
    if (usage.sttSeconds >= config.dailySttSecondCap) {
      throw new VoiceError(
        "Daily voice-transcription backstop reached. It resets tomorrow.",
        429,
        "voice_daily_cap",
      );
    }

    const { mimeType, buffer } = decodeAudio(body);
    const seconds = clipSeconds(body);

    const form = new FormData();
    // Copy into a plain Uint8Array so the Blob part is ArrayBuffer-backed
    // (Node's Buffer is typed over ArrayBufferLike, which Blob rejects).
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      clipFileName(mimeType),
    );
    form.append("model_id", config.sttModel);

    const response = await fetch(`${API_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new VoiceError(
        `Transcription service error (${response.status}): ${detail.slice(0, 300)}`,
        502,
        "voice_provider_error",
      );
    }

    const payload = (await response.json()) as { text?: unknown };
    usage.sttSeconds += seconds;
    console.log(
      `[voice] ${new Date().toISOString()} stt seconds~=${seconds} totalSttSeconds=${usage.sttSeconds}`,
    );

    return {
      transcript: typeof payload.text === "string" ? payload.text.trim() : "",
    };
  }

  async function synthesize(
    body: unknown,
  ): Promise<{ contentType: string; body: ReadableStream<Uint8Array> }> {
    const key = requireKey();
    rollUsage();
    if (usage.ttsChars >= config.dailyTtsCharCap) {
      throw new VoiceError(
        "Daily voice backstop reached. It resets tomorrow.",
        429,
        "voice_daily_cap",
      );
    }

    const text = validateTtsText(body);
    const voiceId = resolveVoiceId(body, config.voiceId);

    const response = await fetch(
      `${API_BASE}/text-to-speech/${voiceId}/stream?output_format=${config.ttsFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: config.ttsModel }),
      },
    );

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new VoiceError(
        `Voice service error (${response.status}): ${detail.slice(0, 300)}`,
        502,
        "voice_provider_error",
      );
    }

    usage.ttsChars += text.length;
    console.log(
      `[voice] ${new Date().toISOString()} tts chars=${text.length} totalTtsChars=${usage.ttsChars}`,
    );

    return { contentType: "audio/mpeg", body: response.body };
  }

  return { status, transcribe, synthesize };
}

export { MAX_TTS_CHARS, MAX_AUDIO_BASE64_CHARS, VOICE_ID_PATTERN };
