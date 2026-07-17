import { AnalyzeRequestSchema, parseAnalysis } from "./contract";
import type { Analysis, AnalyzeRequest } from "./contract";
import { getAuthHeaders } from "./auth";

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredBaseUrl || "http://localhost:3000").replace(/\/$/, "");

export class ScanApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = "ScanApiError";
  }
}

export interface AnalysisResponse {
  scanId: string | null;
  analysis: Analysis;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAnalysis(value: unknown): { scanId: string | null; candidate: unknown } {
  if (!isRecord(value)) return { scanId: null, candidate: value };
  const scanId = typeof value.scan_id === "string" ? value.scan_id : null;
  if ("result_type" in value) return { scanId, candidate: value };
  if ("analysis" in value) return { scanId, candidate: value.analysis };
  if (isRecord(value.diagnosis) && "result_type" in value.diagnosis) {
    return { scanId, candidate: value.diagnosis };
  }
  return { scanId, candidate: value };
}

function errorMessage(value: unknown, status: number): { message: string; code?: string } {
  if (!isRecord(value)) return { message: `Scan failed (${status}).` };
  const code = typeof value.code === "string" ? value.code : undefined;
  const message = typeof value.error === "string"
    ? value.error
    : typeof value.message === "string"
      ? value.message
      : `Scan failed (${status}).`;
  return code ? { message, code } : { message };
}

export async function analyzeScan(
  request: AnalyzeRequest,
  signal?: AbortSignal,
): Promise<AnalysisResponse> {
  const body = AnalyzeRequestSchema.parse(request);
  const authHeaders = await getAuthHeaders();
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/api/v1/scans`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
      ...(signal != null ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ScanApiError(
      `Could not reach FixSight at ${API_BASE_URL}. Check the API address and your connection.`,
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details = errorMessage(payload, response.status);
    throw new ScanApiError(details.message, response.status, details.code);
  }

  const extracted = extractAnalysis(payload);
  try {
    return { scanId: extracted.scanId, analysis: parseAnalysis(extracted.candidate) };
  } catch {
    throw new ScanApiError(
      "The server returned an invalid diagnosis. No advice was shown.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
}
