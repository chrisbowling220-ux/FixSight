/**
 * Live ElevenLabs check — `npm run verify:voice`.
 *
 * Typechecks and unit tests prove the validation logic; they never touch the
 * provider. This does: it drives a full round trip through the same service the
 * server uses, with the key from `.env`.
 *
 *   phrase -> /text-to-speech -> mp3 bytes -> /speech-to-text -> transcript
 *
 * A pass means the key is valid, both model ids are accepted, and the request
 * shapes are right — i.e. the mic button will work. Costs a few hundred
 * characters of TTS and about five seconds of STT.
 */

import "dotenv/config";

import { loadConfig } from "../src/config.js";
import { createVoiceService } from "../src/voice/index.js";

const PHRASE =
  "The water heater in the basement is leaking from the bottom valve.";

/** Words that must survive the round trip for the transcript to count. */
const KEYWORDS = ["water", "heater", "leaking", "valve"];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const { voice } = loadConfig();

  if (!voice.apiKey) {
    console.error(
      "ELEVENLABS_API_KEY is not set.\n" +
        "Add it to .env (get a key at https://elevenlabs.io -> Profile -> API Keys):\n" +
        "  ELEVENLABS_API_KEY=sk_...",
    );
    process.exitCode = 1;
    return;
  }

  const service = createVoiceService(voice);
  console.log(
    `Voice config: tts=${voice.ttsModel} stt=${voice.sttModel} voice=${voice.voiceId}`,
  );

  console.log(`\n1/2 text-to-speech — synthesising ${PHRASE.length} characters…`);
  const spoken = await service.synthesize({ text: PHRASE });
  const audio = await collect(spoken.body);
  if (audio.length === 0) {
    throw new Error("The voice service returned an empty audio stream.");
  }
  console.log(`    ok — ${audio.length.toLocaleString()} bytes of ${spoken.contentType}`);

  console.log("\n2/2 speech-to-text — transcribing that clip back…");
  const { transcript } = await service.transcribe({
    audio: audio.toString("base64"),
    mimeType: "audio/mpeg",
    durationMs: 5_000,
  });
  console.log(`    transcript: ${transcript || "(empty)"}`);

  const heard = normalise(transcript);
  const missing = KEYWORDS.filter((word) => !heard.includes(word));
  if (missing.length > 0) {
    throw new Error(
      `The round trip completed but the transcript is missing: ${missing.join(", ")}`,
    );
  }

  console.log("\nPASS — ElevenLabs voice is working end to end.");
}

main().catch((error: unknown) => {
  console.error(
    `\nFAIL — ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
