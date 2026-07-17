import type {
  AnalysisMetadata,
  AnalysisResult,
} from "../diagnosis-engine.js";
import type { Analysis } from "../diagnosis-contract.js";
import type { AnalyzeRequest } from "../request-schema.js";

export type ScanStatus = "draft" | "complete";

export interface StoredScan {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  status: ScanStatus;
  resolved: boolean;
  resolution_note: string | null;
  refinement_count: number;
  request: AnalyzeRequest;
  analysis: Analysis;
  metadata: AnalysisMetadata;
}

export interface CreateScanRecord {
  user_id: string;
  request: AnalyzeRequest;
  result: AnalysisResult;
}

export interface PublicScan {
  id: string;
  created_at: string;
  updated_at: string;
  status: ScanStatus;
  resolved: boolean;
  resolution_note: string | null;
  refinement_count: number;
  image_count: number;
  category: string | null;
  description: string | null;
  model_id: string;
  prompt_version: string;
  analysis: Analysis;
}

export function toPublicScan(scan: StoredScan): PublicScan {
  return {
    id: scan.id,
    created_at: scan.created_at,
    updated_at: scan.updated_at,
    status: scan.status,
    resolved: scan.resolved,
    resolution_note: scan.resolution_note,
    refinement_count: scan.refinement_count,
    image_count: scan.request.images.length,
    category: scan.request.category ?? null,
    description: scan.request.description ?? null,
    model_id: scan.metadata.model_id,
    prompt_version: scan.metadata.prompt_version,
    analysis: structuredClone(scan.analysis),
  };
}
