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
  /**
   * Optional server-side refusal fallback (beta). Unset by default: it has not
   * been exercised against the live API in this project, and an unaccepted beta
   * parameter would fail every scan.
   */
  refusalFallbackModel?: string;
  /**
   * Per-instance daily backstop on paid analyses. Like the voice caps it is a
   * runaway-loop guard, not a billing limit — set a spend limit on the provider
   * account for that.
   */
  analysisDailyCap: number;
  /**
   * Optional shared access code. When set, every paid endpoint requires the
   * `x-fixsight-access-code` header. A stop-gap against anonymous spend on a
   * public URL — not user authentication.
   */
  accessCode?: string;
  /** Deterministic sample results instead of the AI provider. Never paid. */
  demoMode: boolean;
  /** "production", "preview", "development", "local", or "unknown". */
  deploymentEnvironment: string;
  /** True when a non-production Vercel deployment is locked to demo mode. */
  previewLockdown: boolean;
  /** Simulated latency for demo results, so loading states are visible. */
  demoDelayMs: number;
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
  // Vercel sets VERCEL=1 and VERCEL_ENV on every deployment. Any Vercel
  // deployment that is not production (previews, branch links) runs the demo
  // engine and never holds provider keys, even when the Preview environment has
  // keys configured, so a preview link cannot spend money. This fails closed: a
  // Vercel deployment missing VERCEL_ENV is treated as non-production.
  // FIXSIGHT_ALLOW_PAID_PREVIEW=true deliberately opts a preview back in.
  const onVercel = env.VERCEL === "1";
  const deploymentEnvironment = onVercel ? env.VERCEL_ENV?.trim() || "unknown" : "local";
  const previewLockdown =
    onVercel && deploymentEnvironment !== "production" && env.FIXSIGHT_ALLOW_PAID_PREVIEW !== "true";
  const apiKey = previewLockdown ? undefined : env.ANTHROPIC_API_KEY?.trim();
  const elevenLabsKey = previewLockdown ? undefined : env.ELEVENLABS_API_KEY?.trim();
  return {
    port: integer(env.PORT, 3000, "PORT"),
    host: env.HOST?.trim() || "0.0.0.0",
    ...(apiKey ? { anthropicApiKey: apiKey } : {}),
    // High-resolution vision (2576px long edge) is what `image-processing.ts`
    // targets, and it is the whole product here. Opus 4.6 caps at 1568px.
    model: env.FIXSIGHT_MODEL?.trim() || "claude-opus-5",
    effort: effort(env.FIXSIGHT_EFFORT),
    // Adaptive thinking shares this ceiling with the JSON answer. The v5 schema
    // is larger than v4, and 8,192 risked truncation (stop_reason max_tokens),
    // which discards a paid response. Billing follows tokens actually used.
    maxTokens: integer(
      env.FIXSIGHT_MAX_TOKENS,
      16_000,
      "FIXSIGHT_MAX_TOKENS",
    ),
    ...(env.FIXSIGHT_REFUSAL_FALLBACK_MODEL?.trim()
      ? { refusalFallbackModel: env.FIXSIGHT_REFUSAL_FALLBACK_MODEL.trim() }
      : {}),
    analysisDailyCap: integer(
      env.ANALYSIS_DAILY_CAP,
      300,
      "ANALYSIS_DAILY_CAP",
    ),
    ...(env.FIXSIGHT_ACCESS_CODE?.trim()
      ? { accessCode: env.FIXSIGHT_ACCESS_CODE.trim() }
      : {}),
    demoMode: previewLockdown || env.FIXSIGHT_DEMO_MODE === "true",
    deploymentEnvironment,
    previewLockdown,
    demoDelayMs:
      env.FIXSIGHT_DEMO_DELAY_MS === "0"
        ? 0
        : integer(env.FIXSIGHT_DEMO_DELAY_MS, 900, "FIXSIGHT_DEMO_DELAY_MS"),
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
