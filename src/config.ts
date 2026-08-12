export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * ElevenLabs voice (speech-to-text + text-to-speech). Optional: when the key is
 * absent the voice endpoints report themselves unavailable and the web client
 * simply never shows the mic button — the rest of FixSight is unaffected.
 */
export interface VoiceConfig {
  apiKey?: string;
  sttModel: string;
  ttsModel: string;
  voiceId: string;
  ttsFormat: string;
  dailyTtsCharCap: number;
  dailySttSecondCap: number;
}

export interface AppConfig {
  port: number;
  host: string;
  anthropicApiKey?: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  trustProxy: boolean;
  voice: VoiceConfig;
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function effort(value: string | undefined): Effort {
  const selected = value ?? "high";
  if (!["low", "medium", "high", "xhigh", "max"].includes(selected)) {
    throw new Error(
      "FIXSIGHT_EFFORT must be low, medium, high, xhigh, or max.",
    );
  }
  return selected as Effort;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const elevenLabsKey = env.ELEVENLABS_API_KEY?.trim();
  return {
    port: integer(env.PORT, 3000, "PORT"),
    host: env.HOST?.trim() || "0.0.0.0",
    ...(apiKey ? { anthropicApiKey: apiKey } : {}),
    // High-resolution vision (2576px long edge) is what `image-processing.ts`
    // targets, and it is the whole product here. Opus 4.6 caps at 1568px.
    model: env.FIXSIGHT_MODEL?.trim() || "claude-opus-5",
    effort: effort(env.FIXSIGHT_EFFORT),
    maxTokens: integer(
      env.FIXSIGHT_MAX_TOKENS,
      8_192,
      "FIXSIGHT_MAX_TOKENS",
    ),
    rateLimitWindowMs: integer(
      env.RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1_000,
      "RATE_LIMIT_WINDOW_MS",
    ),
    rateLimitMax: integer(
      env.RATE_LIMIT_MAX,
      20,
      "RATE_LIMIT_MAX",
    ),
    trustProxy: env.TRUST_PROXY === "true",
    voice: {
      ...(elevenLabsKey ? { apiKey: elevenLabsKey } : {}),
      // scribe_v1 is deprecated; scribe_v2 is the current recommended model.
      sttModel: env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2",
      ttsModel: env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
      // The one voice the whole Contractors Office suite speaks in. Placeholder
      // library voice — replace with the chosen brand voice via env.
      voiceId: env.ELEVENLABS_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb",
      ttsFormat: env.ELEVENLABS_TTS_FORMAT?.trim() || "mp3_44100_128",
      dailyTtsCharCap: integer(
        env.VOICE_DAILY_TTS_CHARS,
        200_000,
        "VOICE_DAILY_TTS_CHARS",
      ),
      dailySttSecondCap: integer(
        env.VOICE_DAILY_STT_SECONDS,
        3_600,
        "VOICE_DAILY_STT_SECONDS",
      ),
    },
  };
}
