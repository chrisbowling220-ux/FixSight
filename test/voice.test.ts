import assert from "node:assert/strict";
import test from "node:test";

import { FixSightError } from "../src/errors.js";
import {
  clipFileName,
  clipSeconds,
  createVoiceService,
  decodeAudio,
  resolveVoiceId,
  validateTtsText,
  VOICE_ID_PATTERN,
} from "../src/voice/index.js";
import type { VoiceConfig } from "../src/config.js";

const CONFIG: VoiceConfig = {
  sttModel: "scribe_v2",
  ttsModel: "eleven_flash_v2_5",
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
  ttsFormat: "mp3_44100_128",
  dailyTtsCharCap: 200_000,
  dailySttSecondCap: 3_600,
};

const AUDIO_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).toString("base64");

test("decodeAudio reads a base64 data URL and its mime type", () => {
  const { mimeType, buffer } = decodeAudio({
    audio: `data:audio/webm;base64,${AUDIO_BYTES}`,
  });
  assert.equal(mimeType, "audio/webm");
  assert.equal(buffer.toString("base64"), AUDIO_BYTES);
});

test("decodeAudio falls back to a supplied mime type for raw base64", () => {
  const { mimeType } = decodeAudio({ audio: AUDIO_BYTES, mimeType: "audio/mp4" });
  assert.equal(mimeType, "audio/mp4");
});

test("decodeAudio rejects a missing clip", () => {
  assert.throws(() => decodeAudio({}), FixSightError);
});

test("decodeAudio rejects an oversize clip", () => {
  assert.throws(
    () => decodeAudio({ audio: "a".repeat(4_000_001) }),
    /size limit/,
  );
});

test("clipSeconds rounds up and floors at one second", () => {
  assert.equal(clipSeconds({ durationMs: 2_400 }), 2);
  assert.equal(clipSeconds({ durationMs: 0 }), 1);
  assert.equal(clipSeconds({}), 1);
});

test("validateTtsText trims and enforces the character cap", () => {
  assert.equal(validateTtsText({ text: "  hello  " }), "hello");
  assert.throws(() => validateTtsText({ text: "   " }), /Nothing to say/);
  assert.throws(
    () => validateTtsText({ text: "x".repeat(3_001) }),
    /character limit/,
  );
});

test("resolveVoiceId only honours a well-formed id, else the brand voice", () => {
  assert.equal(
    resolveVoiceId({ voiceId: "abcdefghijkl" }, CONFIG.voiceId),
    "abcdefghijkl",
  );
  assert.equal(resolveVoiceId({ voiceId: "bad id!" }, CONFIG.voiceId), CONFIG.voiceId);
  assert.equal(resolveVoiceId({}, CONFIG.voiceId), CONFIG.voiceId);
  assert.match(CONFIG.voiceId, VOICE_ID_PATTERN);
});

test("status reports unavailable without a key and never leaks it", () => {
  const off = createVoiceService(CONFIG).status();
  assert.equal(off.available, false);
  assert.equal(off.reason, "Voice is not configured on the server.");

  const on = createVoiceService({ ...CONFIG, apiKey: "secret" }).status();
  assert.equal(on.available, true);
  assert.equal(on.reason, undefined);
  assert.equal(JSON.stringify(on).includes("secret"), false);
});

test("transcribe/synthesize refuse to run when voice is unconfigured", async () => {
  const service = createVoiceService(CONFIG);
  await assert.rejects(
    () => service.transcribe({ audio: `data:audio/webm;base64,${AUDIO_BYTES}` }),
    (error: unknown) =>
      error instanceof FixSightError && error.status === 503,
  );
  await assert.rejects(
    () => service.synthesize({ text: "hello" }),
    (error: unknown) =>
      error instanceof FixSightError && error.status === 503,
  );
});
