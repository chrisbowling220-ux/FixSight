import { z } from "zod";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ImageInputSchema = z
  .object({
    data: z
      .string()
      .min(1)
      .refine((value) => value.length % 4 === 0 && BASE64_PATTERN.test(value), {
        message: "Image data must be raw, padded base64.",
      })
      .refine(
        (value) => Buffer.byteLength(value, "base64") <= MAX_IMAGE_BYTES,
        { message: "Each image must be 10 MiB or smaller." },
      ),
    media_type: z.enum(SUPPORTED_MEDIA_TYPES),
  })
  .strict();

const AnswerSchema = z
  .object({
    question_id: z.string().trim().min(1).max(100),
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(1_000),
  })
  .strict();

const CanonicalAnalyzeRequestSchema = z
  .object({
    images: z.array(ImageInputSchema).min(1).max(MAX_IMAGES),
    category: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2_000).optional(),
    answers: z.array(AnswerSchema).max(3).default([]),
  })
  .strict();

export type AnalyzeRequest = z.infer<typeof CanonicalAnalyzeRequestSchema>;
export type ImageInput = AnalyzeRequest["images"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLegacyRequest(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const hasLegacyImage = "image" in value || "mediaType" in value;
  if (!hasLegacyImage) return value;

  const qa = Array.isArray(value.qa) ? value.qa : [];
  const answers = qa.map((item, index) => {
    if (!isRecord(item)) return item;
    return {
      question_id: `legacy-${index + 1}`,
      question: item.question,
      answer: item.answer,
    };
  });

  const normalized: Record<string, unknown> = {
    images: [{ data: value.image, media_type: value.mediaType }],
    answers,
  };
  if ("category" in value) normalized.category = value.category;
  if ("description" in value) normalized.description = value.description;
  return normalized;
}

export function parseAnalyzeRequest(value: unknown): AnalyzeRequest {
  if (!isRecord(value)) {
    return CanonicalAnalyzeRequestSchema.parse(value);
  }
  return CanonicalAnalyzeRequestSchema.parse(normalizeLegacyRequest(value));
}
