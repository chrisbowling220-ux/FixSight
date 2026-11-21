import "dotenv/config";

import { createApp } from "./app.js";
import { networkInterfaces } from "node:os";

import { loadConfig } from "./config.js";
import { createDiagnosisEngine } from "./usage-guard.js";

const config = loadConfig();
const engine = createDiagnosisEngine(config);
const app = createApp({ config, engine });

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address);
}

const server = app.listen(config.port, config.host, () => {
  const mode = config.demoMode ? "DEMO MODE (sample results, no AI calls)" : config.model;
  console.log(`FixSight running at http://localhost:${config.port} — ${mode}`);
  for (const address of lanAddresses()) {
    console.log(`  On a phone or tablet on the same Wi-Fi: http://${address}:${config.port}`);
  }
  if (!config.demoMode && !config.anthropicApiKey) {
    console.warn(
      "ANTHROPIC_API_KEY is not set. The app and saved inspections work, but new analyses return 503. Use `npm run demo` for sample results.",
    );
  }
  if (config.accessCode) console.log("An access code is required for analysis and voice requests.");
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
