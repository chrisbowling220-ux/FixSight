export type Effort = "low" | "medium" | "high" | "max";

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
  if (!["low", "medium", "high", "max"].includes(selected)) {
    throw new Error("FIXSIGHT_EFFORT must be low, medium, high, or max.");
  }
  return selected as Effort;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  return {
    port: integer(env.PORT, 3000, "PORT"),
    host: env.HOST?.trim() || "0.0.0.0",
    ...(apiKey ? { anthropicApiKey: apiKey } : {}),
    model: env.FIXSIGHT_MODEL?.trim() || "claude-opus-4-8",
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
  };
}
