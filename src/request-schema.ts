import { CanonicalAnalyzeRequestSchema, type AnalyzeRequest } from "./request-wire.js";
export * from "./request-wire.js";

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
  if ("vision_mode" in value) normalized.vision_mode = value.vision_mode;
  return normalized;
}

export function parseAnalyzeRequest(value: unknown): AnalyzeRequest {
  if (!isRecord(value)) {
    return CanonicalAnalyzeRequestSchema.parse(value);
  }
  return CanonicalAnalyzeRequestSchema.parse(normalizeLegacyRequest(value));
}
