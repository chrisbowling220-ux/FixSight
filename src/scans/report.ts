import type { Analysis } from "../diagnosis-contract.js";
import type { Reading } from "../request-schema.js";
import type { StoredScan } from "./types.js";

export interface ScanReport {
  report_version: "fixsight_report_v1";
  scan_id: string;
  assessed_at: string;
  updated_at: string;
  model_id: string;
  prompt_version: string;
  status: StoredScan["status"];
  resolved: boolean;
  resolution_note: string | null;
  assessment: Analysis;
  /** Verbatim instrument inputs — a contractor reading this needs the raw numbers. */
  readings: Reading[];
  share_text: string;
  disclaimer: "FixSight gives a first-look estimate, not a professional inspection.";
}

const DISCLAIMER =
  "FixSight gives a first-look estimate, not a professional inspection." as const;

function shareText(scan: StoredScan): string {
  const analysis = scan.analysis;
  const heading = `FixSight first-look report — ${scan.created_at}`;

  if (analysis.result_type === "questions") {
    return [heading, analysis.note, "Status: follow-up answers required.", DISCLAIMER].join(
      "\n",
    );
  }
  if (analysis.result_type === "retake") {
    return [
      heading,
      analysis.note,
      `Retake guidance: ${analysis.retake_guidance.join("; ")}`,
      DISCLAIMER,
    ].join("\n");
  }
  if (analysis.result_type === "cannot_assess") {
    return [heading, analysis.note, "Status: unable to assess from the supplied photos.", DISCLAIMER].join(
      "\n",
    );
  }

  const diagnosis = analysis.diagnosis;
  if (!diagnosis) {
    throw new Error("A diagnosis report requires diagnosis details.");
  }

  const next = diagnosis.next_measurement;

  return [
    heading,
    `Subject: ${diagnosis.subject}`,
    `Assessment: ${diagnosis.diagnosis}`,
    `Likely cause: ${diagnosis.likely_cause}`,
    `Severity: ${diagnosis.severity}/10 (${diagnosis.urgency})`,
    `Confidence: ${Math.round(diagnosis.confidence * 100)}%`,
    ...readingLines(scan.request.readings),
    `Recommended fix: ${diagnosis.recommendation.best_fix}`,
    ...(next
      ? [
          `Next measurement: ${next.instrument.replace(/_/g, " ")} at ${next.target}`,
          `  What it would tell you: ${next.expected_discriminator}`,
          ...(next.safety_note ? [`  Safety: ${next.safety_note}`] : []),
        ]
      : []),
    `Professional recommended: ${diagnosis.needs_professional ? "yes" : "no"}`,
    `Resolution: ${scan.resolved ? scan.resolution_note ?? "marked resolved" : "open"}`,
    DISCLAIMER,
  ].join("\n");
}

function readingLines(readings: readonly Reading[]): string[] {
  if (readings.length === 0) return [];
  return [
    "Readings supplied:",
    ...readings.map((reading) => {
      if (reading.kind === "moisture") {
        const measured =
          reading.scale === "qualitative"
            ? String(reading.qualitative)
            : `${String(reading.value)} (${reading.scale})`;
        const reference =
          reading.reference_value !== undefined
            ? `, dry reference ${String(reading.reference_value)}${
                reading.reference_location
                  ? ` at ${reading.reference_location}`
                  : ""
              }`
            : ", no dry reference supplied";
        return `  Moisture at ${reading.location}: ${measured}${reference}`;
      }
      if (reading.kind === "temperature") {
        return `  Temperature at ${reading.location}: ${String(reading.value)}°${reading.unit.toUpperCase()}`;
      }
      const air =
        reading.air_temperature !== undefined
          ? ` at ${String(reading.air_temperature)}°${(reading.unit ?? "f").toUpperCase()}`
          : "";
      return `  Humidity at ${reading.location}: ${String(reading.relative_humidity)}% RH${air}`;
    }),
  ];
}

/** Builds a stable share payload from stored fields only; it never calls a model. */
export function buildScanReport(scan: StoredScan): ScanReport {
  return {
    report_version: "fixsight_report_v1",
    scan_id: scan.id,
    assessed_at: scan.created_at,
    updated_at: scan.updated_at,
    model_id: scan.metadata.model_id,
    prompt_version: scan.metadata.prompt_version,
    status: scan.status,
    resolved: scan.resolved,
    resolution_note: scan.resolution_note,
    assessment: structuredClone(scan.analysis),
    readings: structuredClone(scan.request.readings),
    share_text: shareText(scan),
    disclaimer: DISCLAIMER,
  };
}
