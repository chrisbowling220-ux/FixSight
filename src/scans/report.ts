import type { Analysis } from "../diagnosis-contract.js";
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

  return [
    heading,
    `Subject: ${diagnosis.subject}`,
    `Assessment: ${diagnosis.diagnosis}`,
    `Likely cause: ${diagnosis.likely_cause}`,
    `Severity: ${diagnosis.severity}/10 (${diagnosis.urgency})`,
    `Confidence: ${Math.round(diagnosis.confidence * 100)}%`,
    `Recommended fix: ${diagnosis.recommendation.best_fix}`,
    `Professional recommended: ${diagnosis.needs_professional ? "yes" : "no"}`,
    `Resolution: ${scan.resolved ? scan.resolution_note ?? "marked resolved" : "open"}`,
    DISCLAIMER,
  ].join("\n");
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
    share_text: shareText(scan),
    disclaimer: DISCLAIMER,
  };
}
