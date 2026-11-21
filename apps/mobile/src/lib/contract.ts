import { z } from "zod";
import { AnswerSchema, CanonicalAnalyzeRequestSchema, SUPPORTED_MEDIA_TYPES } from "./request-wire";
export { CanonicalAnalyzeRequestSchema as AnalyzeRequestSchema } from "./request-wire";
export const MediaTypeSchema = z.enum(SUPPORTED_MEDIA_TYPES);
export const ScanAnswerSchema = AnswerSchema;
export { MAX_IMAGES } from "./request-wire";

import { BaseAnalysisSchema, DiagnosisSchema, FollowUpQuestionSchema } from "./diagnosis-wire";
export { BaseAnalysisSchema as AnalysisSchema, DiagnosisSchema, FollowUpQuestionSchema } from "./diagnosis-wire";

export type MediaType = z.infer<typeof MediaTypeSchema>;
export type ScanAnswer = z.infer<typeof ScanAnswerSchema>;
export type AnalyzeRequest = z.input<typeof CanonicalAnalyzeRequestSchema>;
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Analysis = z.infer<typeof BaseAnalysisSchema>;

export function parseAnalysis(value: unknown): Analysis {
  // Earlier locally saved diagnoses predate next_measurement. Keep them readable.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const diagnosis = record.diagnosis;
    if (diagnosis && typeof diagnosis === "object" && !Array.isArray(diagnosis) && !("next_measurement" in diagnosis)) {
      value = { ...record, diagnosis: { ...diagnosis, next_measurement: null } };
    }
  }
  return BaseAnalysisSchema.parse(value);
}
