import { randomUUID } from "node:crypto";

import type { AnalysisResult } from "../diagnosis-engine.js";
import type { AnalyzeRequest } from "../request-schema.js";
import type { CreateScanRecord, StoredScan } from "./types.js";

export type RefinementRejection =
  | "not_found"
  | "not_awaiting_answers"
  | "already_refined"
  | "in_progress"
  | "resolved";

export type RefinementClaim =
  | { ok: true; scan: StoredScan }
  | { ok: false; reason: RefinementRejection };

export interface ScanRepository {
  create(input: CreateScanRecord): Promise<StoredScan>;
  listForUser(userId: string): Promise<StoredScan[]>;
  getForUser(userId: string, scanId: string): Promise<StoredScan | null>;
  claimRefinement(userId: string, scanId: string): Promise<RefinementClaim>;
  completeRefinement(
    userId: string,
    scanId: string,
    request: AnalyzeRequest,
    result: AnalysisResult,
  ): Promise<StoredScan>;
  releaseRefinement(userId: string, scanId: string): Promise<void>;
  setResolution(
    userId: string,
    scanId: string,
    resolved: boolean,
    note: string | null,
  ): Promise<StoredScan | null>;
}

export interface InMemoryScanRepositoryOptions {
  maxEntries?: number;
  maxImageBytes?: number;
  idFactory?: () => string;
  now?: () => Date;
}

interface InternalScan {
  value: StoredScan;
  imageBytes: number;
  refinementInProgress: boolean;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_IMAGE_BYTES = 128 * 1024 * 1024;

function copy(scan: StoredScan): StoredScan {
  return structuredClone(scan);
}

function requestImageBytes(request: AnalyzeRequest): number {
  return request.images.reduce(
    (total, image) => total + Buffer.byteLength(image.data, "base64"),
    0,
  );
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

/**
 * A bounded, process-local repository for development and tests.
 *
 * It never exposes a lookup that omits userId, and it evicts the oldest idle scan
 * before accepting data beyond its configured entry/byte limits. Production should
 * replace this adapter with durable storage implementing the same interface.
 */
export class InMemoryScanRepository implements ScanRepository {
  private readonly records = new Map<string, InternalScan>();
  private readonly maxEntries: number;
  private readonly maxImageBytes: number;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private retainedImageBytes = 0;

  constructor(options: InMemoryScanRepositoryOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    validatePositiveInteger(this.maxEntries, "maxEntries");
    validatePositiveInteger(this.maxImageBytes, "maxImageBytes");
  }

  async create(input: CreateScanRecord): Promise<StoredScan> {
    const imageBytes = requestImageBytes(input.request);
    if (imageBytes > this.maxImageBytes) {
      throw new ScanRepositoryCapacityError(
        "This scan is larger than the in-memory repository limit.",
      );
    }

    this.makeRoom(imageBytes);
    const timestamp = this.now().toISOString();
    const id = this.uniqueId();
    const scan: StoredScan = {
      id,
      user_id: input.user_id,
      created_at: timestamp,
      updated_at: timestamp,
      status:
        input.result.analysis.result_type === "questions" ? "draft" : "complete",
      resolved: false,
      resolution_note: null,
      refinement_count: 0,
      request: structuredClone(input.request),
      analysis: structuredClone(input.result.analysis),
      metadata: structuredClone(input.result.metadata),
    };
    this.records.set(id, {
      value: scan,
      imageBytes,
      refinementInProgress: false,
    });
    this.retainedImageBytes += imageBytes;
    return copy(scan);
  }

  async listForUser(userId: string): Promise<StoredScan[]> {
    return [...this.records.values()]
      .filter((record) => record.value.user_id === userId)
      .map((record) => copy(record.value))
      .sort((left, right) => {
        const byCreatedAt = right.created_at.localeCompare(left.created_at);
        return byCreatedAt !== 0 ? byCreatedAt : right.id.localeCompare(left.id);
      });
  }

  async getForUser(userId: string, scanId: string): Promise<StoredScan | null> {
    const record = this.records.get(scanId);
    return record?.value.user_id === userId ? copy(record.value) : null;
  }

  async claimRefinement(
    userId: string,
    scanId: string,
  ): Promise<RefinementClaim> {
    const record = this.records.get(scanId);
    if (!record || record.value.user_id !== userId) {
      return { ok: false, reason: "not_found" };
    }
    if (record.value.resolved) return { ok: false, reason: "resolved" };
    if (record.refinementInProgress) {
      return { ok: false, reason: "in_progress" };
    }
    if (record.value.refinement_count >= 1) {
      return { ok: false, reason: "already_refined" };
    }
    if (record.value.analysis.result_type !== "questions") {
      return { ok: false, reason: "not_awaiting_answers" };
    }

    record.refinementInProgress = true;
    return { ok: true, scan: copy(record.value) };
  }

  async completeRefinement(
    userId: string,
    scanId: string,
    request: AnalyzeRequest,
    result: AnalysisResult,
  ): Promise<StoredScan> {
    const record = this.records.get(scanId);
    if (
      !record ||
      record.value.user_id !== userId ||
      !record.refinementInProgress
    ) {
      throw new Error("Cannot complete a refinement that was not claimed.");
    }

    record.value = {
      ...record.value,
      updated_at: this.now().toISOString(),
      status: "complete",
      refinement_count: record.value.refinement_count + 1,
      request: structuredClone(request),
      analysis: structuredClone(result.analysis),
      metadata: structuredClone(result.metadata),
    };
    record.refinementInProgress = false;
    return copy(record.value);
  }

  async releaseRefinement(userId: string, scanId: string): Promise<void> {
    const record = this.records.get(scanId);
    if (record?.value.user_id === userId) {
      record.refinementInProgress = false;
    }
  }

  async setResolution(
    userId: string,
    scanId: string,
    resolved: boolean,
    note: string | null,
  ): Promise<StoredScan | null> {
    const record = this.records.get(scanId);
    if (!record || record.value.user_id !== userId) return null;
    record.value = {
      ...record.value,
      updated_at: this.now().toISOString(),
      resolved,
      resolution_note: resolved ? note : null,
    };
    return copy(record.value);
  }

  private makeRoom(incomingImageBytes: number): void {
    while (
      this.records.size >= this.maxEntries ||
      this.retainedImageBytes + incomingImageBytes > this.maxImageBytes
    ) {
      const eviction = [...this.records.entries()].find(
        ([, record]) => !record.refinementInProgress,
      );
      if (!eviction) {
        throw new ScanRepositoryCapacityError(
          "The in-memory scan repository is temporarily full.",
        );
      }
      const [id, record] = eviction;
      this.records.delete(id);
      this.retainedImageBytes -= record.imageBytes;
    }
  }

  private uniqueId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = this.idFactory();
      if (candidate.trim() !== "" && !this.records.has(candidate)) {
        return candidate;
      }
    }
    throw new Error("The scan id factory did not produce a unique id.");
  }
}

export class ScanRepositoryCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanRepositoryCapacityError";
  }
}
