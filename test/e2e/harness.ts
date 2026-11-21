// Shared harness for browser tests: a demo-mode FixSight server on a random
// port and a headless browser (system Chrome, or Playwright's WebKit build).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { chromium, webkit, type Browser, type BrowserContextOptions } from "playwright-core";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { DemoDiagnosisEngine } from "../../src/demo-engine.js";

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export async function startDemoServer(env: Record<string, string> = {}): Promise<RunningServer> {
  const config = loadConfig({ FIXSIGHT_DEMO_MODE: "true", RATE_LIMIT_MAX: "1000", ...env });
  const app = createApp({
    config,
    engine: new DemoDiagnosisEngine(Number(env.FIXSIGHT_DEMO_DELAY_MS ?? 250)),
    publicDir: path.resolve(import.meta.dirname, "../../public"),
  });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter((value): value is string => Boolean(value));

export function chromePath(): string | null {
  return CHROME_PATHS.find((candidate) => existsSync(candidate)) ?? null;
}

export async function launch(engine: "chrome" | "webkit" = "chrome"): Promise<Browser> {
  if (engine === "webkit") return webkit.launch({ headless: true });
  const executablePath = chromePath();
  if (!executablePath) throw new Error("Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.");
  return chromium.launch({
    headless: true,
    executablePath,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-first-run"],
  });
}

export const DEVICES: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1366, height: 860 } },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  },
  tablet: {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

/** A synthetic "ceiling stain" photo with texture, so the sharpness check passes. */
export async function stainPhoto(width = 1600, height = 1200, blur = 0): Promise<Buffer> {
  const dots = Array.from({ length: 900 }, (_, index) => {
    const x = (index * 97) % width;
    const y = (index * 211) % height;
    return `<circle cx="${x}" cy="${y}" r="${1 + (index % 3)}" fill="#c9c4b8"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#f2efe8"/>${dots}
    <ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 5}" ry="${height / 6}" fill="#d8c29a" stroke="#8a6a3a" stroke-width="10"/>
    <line x1="0" y1="${height * 0.2}" x2="${width}" y2="${height * 0.22}" stroke="#bdb6a6" stroke-width="4"/>
  </svg>`;
  let image = sharp(Buffer.from(svg));
  if (blur > 0) image = image.blur(blur);
  return image.jpeg({ quality: 85 }).toBuffer();
}
