// Network access to the FixSight server, with deadlines, the optional access
// code, and error messages a person can act on.

import { getSetting } from "./db.js";

export const ANALYSIS_TIMEOUT_MS = 150_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "network_error", retryable = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function headers(extra = {}) {
  const code = await getSetting("accessCode", "");
  return {
    "Content-Type": "application/json",
    ...(code ? { "x-fixsight-access-code": code } : {}),
    ...extra,
  };
}

const FRIENDLY = {
  access_code_required: "This server needs an access code. Add it in Settings.",
  analysis_unavailable: "This server isn't set up for AI analysis yet. Your inspection is saved as a draft.",
  analysis_daily_cap: "Today's analysis limit has been reached. Your inspection is saved as a draft.",
  rate_limited: "Too many requests from this connection. Wait a few minutes and try again.",
  provider_rate_limited: "The analysis service is busy. Wait a moment and try again.",
  request_too_large: "The photos are too large to send. Remove one and try again.",
  invalid_image: "One of the photos couldn't be read. Try retaking it.",
};

async function request(path, { method = "GET", body, timeoutMs = 15_000, signal } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: await headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data?.code ?? `http_${response.status}`;
      throw new ApiError(FRIENDLY[code] ?? data?.error ?? `The server returned an error (${response.status}).`, {
        status: response.status,
        code,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw new ApiError("Cancelled.", { code: "cancelled" });
    if (timedOut) {
      throw new ApiError(
        "The analysis took too long. It may still finish on the server; wait a minute before trying again so you aren't charged twice.",
        { code: "timeout", retryable: true },
      );
    }
    throw new ApiError("Couldn't reach the FixSight server. Check your connection; your inspection is saved on this device.", {
      code: "network_error",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function health() {
  return request("/api/health", { timeoutMs: 6_000 });
}

export function voiceStatus() {
  return request("/api/voice/status", { timeoutMs: 6_000 });
}

function stripDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Builds the analysis request body from a stored inspection. Exported for tests. */
export function buildAnalyzeBody(inspection, answers = []) {
  return {
    images: inspection.photos.map((photo) => ({
      data: stripDataUrl(photo.dataUrl),
      media_type: "image/jpeg",
      ...(photo.role ? { role: photo.role } : {}),
      ...(photo.annotated ? { annotated: true } : {}),
    })),
    ...(inspection.category ? { category: inspection.category } : {}),
    ...(inspection.description ? { description: inspection.description } : {}),
    readings: inspection.readings ?? [],
    answers,
  };
}

export function analyze(inspection, answers = [], signal) {
  return request("/api/analyze", {
    method: "POST",
    body: buildAnalyzeBody(inspection, answers),
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    signal,
  });
}

export async function transcribe(audioDataUrl, mimeType, durationMs) {
  return request("/api/voice/transcribe", {
    method: "POST",
    body: { audio: audioDataUrl, mimeType, durationMs },
    timeoutMs: 60_000,
  });
}

export async function synthesize(text, signal) {
  const response = await fetch("/api/voice/synthesize", {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(FRIENDLY[data?.code] ?? data?.error ?? "Audio could not be prepared.", {
      status: response.status,
      code: data?.code ?? "voice_error",
    });
  }
  return response.blob();
}
