import type { AppConfig } from "./config.js";
import { DemoDiagnosisEngine } from "./demo-engine.js";
import {
  AnthropicDiagnosisEngine,
  UnavailableDiagnosisEngine,
  type AnalysisResult,
  type DiagnosisEngine,
} from "./diagnosis-engine.js";
import { FixSightError } from "./errors.js";
import type { AnalyzeRequest } from "./request-schema.js";

export class DailyCapError extends FixSightError {
  constructor() {
    super(
      "FixSight has reached today's analysis limit on this server. Saved inspections remain available; try again tomorrow.",
      429,
      "analysis_daily_cap",
      true,
    );
  }
}

/**
 * Counts paid analysis attempts per UTC day and refuses once the cap is hit.
 *
 * Attempts are counted before the provider call because a failed or abandoned
 * call can still be billed. Like the voice backstop, the counter lives in one
 * process: on serverless hosting the effective ceiling is per warm instance.
 * It stops a runaway loop; the provider account's spend limit is the real cap.
 */
export class DailyCappedEngine implements DiagnosisEngine {
  private day = "";
  private count = 0;

  constructor(
    private readonly inner: DiagnosisEngine,
    private readonly cap: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get usedToday(): number {
    this.roll();
    return this.count;
  }

  private roll(): void {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
  }

  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    this.roll();
    if (this.count >= this.cap) throw new DailyCapError();
    this.count += 1;
    return this.inner.analyze(request);
  }
}

/** Chooses the engine for a configuration; shared by server.ts and api/index.js. */
export function createDiagnosisEngine(config: AppConfig): DiagnosisEngine {
  if (config.demoMode) return new DemoDiagnosisEngine(config.demoDelayMs);
  if (!config.anthropicApiKey) return new UnavailableDiagnosisEngine();
  return new DailyCappedEngine(new AnthropicDiagnosisEngine(config), config.analysisDailyCap);
}
