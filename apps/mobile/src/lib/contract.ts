import { z } from "zod";
import { AnswerSchema, CanonicalAnalyzeRequestSchema, SUPPORTED_MEDIA_TYPES } from "./request-wire";
export { CanonicalAnalyzeRequestSchema as AnalyzeRequestSchema } from "./request-wire";
export const MediaTypeSchema = z.enum(SUPPORTED_MEDIA_TYPES);
export const ScanAnswerSchema = AnswerSchema;
export { MAX_IMAGES } from "./request-wire";

import { FollowUpQuestionSchema, StoredAnalysisSchema, StoredDiagnosisSchema, upgradeStoredAnalysis } from "./diagnosis-wire";
export { FollowUpQuestionSchema, StoredAnalysisSchema as AnalysisSchema, StoredDiagnosisSchema as DiagnosisSchema } from "./diagnosis-wire";

export type MediaType = z.infer<typeof MediaTypeSchema>;
export type ScanAnswer = z.infer<typeof ScanAnswerSchema>;
export type AnalyzeRequest = z.input<typeof CanonicalAnalyzeRequestSchema>;
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type Diagnosis = z.infer<typeof StoredDiagnosisSchema>;
export type Analysis = z.infer<typeof StoredAnalysisSchema>;

/**
 * Parses a server response or a locally saved record. Records saved by earlier
 * versions lack the v5 fields (and some lack next_measurement); the shared
 * upgrader supplies neutral defaults so they stay readable.
 */
export function parseAnalysis(value: unknown): Analysis {
  return StoredAnalysisSchema.parse(upgradeStoredAnalysis(value));
}
