import { z } from "zod";

export const MAX_IMAGES = 4;
export const MediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const ScanAnswerSchema = z.object({
  question_id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(1_000),
}).strict();

export const AnalyzeRequestSchema = z.object({
  images: z.array(z.object({
    data: z.string().min(1),
    media_type: MediaTypeSchema,
  }).strict()).min(1).max(MAX_IMAGES),
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2_000).optional(),
  answers: z.array(ScanAnswerSchema).max(3),
}).strict();

export const FollowUpQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(300),
  why_it_matters: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
}).strict();

export const DiagnosisSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  diagnosis: z.string().trim().min(1).max(1_000),
  likely_cause: z.string().trim().min(1).max(2_000),
  severity: z.number().int().min(0).max(10),
  urgency: z.enum(["cosmetic", "monitor", "soon", "urgent"]),
  confidence: z.number().finite().min(0).max(1),
  safe_to_diy: z.boolean(),
  recommendation: z.object({
    best_fix: z.string().trim().min(1).max(2_000),
    cheap_or_temp_fix: z.string().trim().min(1).max(2_000),
    tools_or_parts: z.array(z.string().trim().min(1).max(200)).max(30),
    difficulty: z.enum(["easy", "moderate", "hard", "pro-only"]),
  }).strict(),
  risk_if_ignored: z.string().trim().min(1).max(2_000),
  needs_professional: z.boolean(),
  professional_type: z.enum([
    "electrician", "gas_technician", "structural_engineer", "roofer",
    "plumber", "hvac", "water_mitigation", "mold_remediation",
    "general_contractor", "foundation_specialist", "other",
  ]).nullable(),
  safety_warnings: z.array(z.string().trim().min(1).max(500)).max(10),
  disclaimer_required: z.boolean(),
}).strict();

export const AnalysisSchema = z.object({
  result_type: z.enum(["questions", "diagnosis", "retake", "cannot_assess"]),
  note: z.string().trim().min(1).max(1_000),
  image_quality: z.enum(["good", "usable", "poor"]),
  retake_guidance: z.array(z.string().trim().min(1).max(300)).max(5),
  follow_up_questions: z.array(FollowUpQuestionSchema).max(3),
  diagnosis: DiagnosisSchema.nullable(),
}).strict();

export type MediaType = z.infer<typeof MediaTypeSchema>;
export type ScanAnswer = z.infer<typeof ScanAnswerSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

export function parseAnalysis(value: unknown): Analysis {
  return AnalysisSchema.parse(value);
}
