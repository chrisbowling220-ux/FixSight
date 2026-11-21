// Vercel serverless entry point.
// `npm run build` compiles src/ → dist/ before this runs.
// Exports the Express app without calling listen() — Vercel wraps it.
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";
import { createDiagnosisEngine } from "../dist/usage-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = loadConfig();
const engine = createDiagnosisEngine(config);

export default createApp({
  config,
  engine,
  // Resolve relative to this file so the path is correct inside Vercel's Lambda.
  publicDir: path.resolve(__dirname, "../public"),
});
