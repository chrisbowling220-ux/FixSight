import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  AnthropicDiagnosisEngine,
  UnavailableDiagnosisEngine,
} from "./diagnosis-engine.js";

const config = loadConfig();
const engine = config.anthropicApiKey
  ? new AnthropicDiagnosisEngine(config)
  : new UnavailableDiagnosisEngine();
const app = createApp({ config, engine });

const server = app.listen(config.port, config.host, () => {
  console.log(
    `FixSight running at http://localhost:${config.port} with ${config.model}`,
  );
  if (!config.anthropicApiKey) {
    console.warn(
      "ANTHROPIC_API_KEY is not set. The UI and health endpoint work, but scans return 503.",
    );
  }
});

function shutdown(signal: string): void {
  console.log(`${signal} received; closing FixSight.`);
  server.close((error) => {
    if (error) {
      console.error("Failed to close cleanly.", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
