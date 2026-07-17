import { useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useScanFlow } from "../src/state/ScanFlowContext";
import type { Analysis, Diagnosis } from "../src/lib/contract";
import { colors, radius, shadow } from "../src/theme";

// ── helpers ────────────────────────────────────────────────────────────────

function urgencyLabel(urgency: Diagnosis["urgency"]): string {
  switch (urgency) {
    case "cosmetic": return "Cosmetic";
    case "monitor": return "Monitor";
    case "soon": return "Fix Soon";
    case "urgent": return "Urgent";
  }
}

function urgencyColors(urgency: Diagnosis["urgency"]): { bg: string; fg: string } {
  switch (urgency) {
    case "cosmetic": return { bg: colors.blueSoft, fg: colors.blue };
    case "monitor": return { bg: colors.brandSoft, fg: colors.brand };
    case "soon": return { bg: colors.warningSoft, fg: colors.warning };
    case "urgent": return { bg: colors.dangerSoft, fg: colors.danger };
  }
}

function difficultyLabel(difficulty: Diagnosis["recommendation"]["difficulty"]): string {
  switch (difficulty) {
    case "easy": return "Easy DIY";
    case "moderate": return "Moderate DIY";
    case "hard": return "Hard DIY";
    case "pro-only": return "Professional only";
  }
}

function difficultyColors(difficulty: Diagnosis["recommendation"]["difficulty"]): {
  bg: string;
  fg: string;
} {
  switch (difficulty) {
    case "easy": return { bg: colors.brandSoft, fg: colors.brand };
    case "moderate": return { bg: colors.warningSoft, fg: colors.warning };
    case "hard": return { bg: colors.warningSoft, fg: colors.warning };
    case "pro-only": return { bg: colors.dangerSoft, fg: colors.danger };
  }
}

function severityColor(severity: number): string {
  if (severity >= 7) return colors.danger;
  if (severity >= 4) return colors.warning;
  return colors.brand;
}

// ── sub-components ─────────────────────────────────────────────────────────

function SeverityBar({ severity }: { severity: number }) {
  return (
    <View style={severityStyles.container}>
      <Text style={severityStyles.label}>Severity</Text>
      <View style={severityStyles.bar}>
        {Array.from({ length: 10 }, (_, i) => {
          const filled = i < severity;
          const color = filled ? severityColor(severity) : colors.line;
          return (
            <View
              key={i}
              style={[severityStyles.segment, { backgroundColor: color }]}
            />
          );
        })}
      </View>
      <Text style={[severityStyles.value, { color: severityColor(severity) }]}>
        {severity}/10
      </Text>
    </View>
  );
}

const severityStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: "500",
    width: 58,
  },
  bar: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 8,
    borderRadius: 4,
  },
  value: {
    fontSize: 13,
    fontWeight: "700",
    width: 34,
    textAlign: "right",
  },
});

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[badgeStyles.container, { backgroundColor: bg }]}>
      <Text style={[badgeStyles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
  },
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.container}>
      <Text style={sectionStyles.title}>{title}</Text>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});

// ── diagnosis card ─────────────────────────────────────────────────────────

function DiagnosisCard({ d }: { d: Diagnosis }) {
  const urgencyC = urgencyColors(d.urgency);
  const diffC = difficultyColors(d.recommendation.difficulty);

  return (
    <View style={styles.cardGap}>
      {/* Subject & confidence */}
      <View style={cardStyles.heroCard}>
        <Text style={cardStyles.subject}>{d.subject}</Text>
        <View style={cardStyles.metaRow}>
          <Badge
            label={urgencyLabel(d.urgency)}
            bg={urgencyC.bg}
            fg={urgencyC.fg}
          />
          <Text style={cardStyles.confidence}>
            {Math.round(d.confidence * 100)}% confidence
          </Text>
        </View>
        <SeverityBar severity={d.severity} />
      </View>

      {/* Diagnosis text */}
      <View style={cardStyles.card}>
        <Section title="Diagnosis">
          <Text style={cardStyles.bodyText}>{d.diagnosis}</Text>
        </Section>
      </View>

      {/* Likely cause */}
      <View style={cardStyles.card}>
        <Section title="Likely Cause">
          <Text style={cardStyles.bodyText}>{d.likely_cause}</Text>
        </Section>
      </View>

      {/* Recommendations */}
      <View style={cardStyles.card}>
        <Section title="Recommended Fix">
          <Text style={cardStyles.subheading}>Best fix</Text>
          <Text style={cardStyles.bodyText}>{d.recommendation.best_fix}</Text>
          <Text style={[cardStyles.subheading, { marginTop: 12 }]}>
            Cheap or temporary fix
          </Text>
          <Text style={cardStyles.bodyText}>{d.recommendation.cheap_or_temp_fix}</Text>
          {d.recommendation.tools_or_parts.length > 0 && (
            <>
              <Text style={[cardStyles.subheading, { marginTop: 12 }]}>
                Tools / Parts needed
              </Text>
              {d.recommendation.tools_or_parts.map((item, i) => (
                <Text key={i} style={cardStyles.bulletItem}>
                  {"\u2022"} {item}
                </Text>
              ))}
            </>
          )}
          <View style={cardStyles.diffRow}>
            <Badge
              label={difficultyLabel(d.recommendation.difficulty)}
              bg={diffC.bg}
              fg={diffC.fg}
            />
            <Badge
              label={d.safe_to_diy ? "Safe to DIY" : "Not safe for DIY"}
              bg={d.safe_to_diy ? colors.brandSoft : colors.dangerSoft}
              fg={d.safe_to_diy ? colors.brand : colors.danger}
            />
          </View>
        </Section>
      </View>

      {/* Risk if ignored */}
      <View style={cardStyles.card}>
        <Section title="Risk if Ignored">
          <Text style={cardStyles.bodyText}>{d.risk_if_ignored}</Text>
        </Section>
      </View>

      {/* Safety warnings */}
      {d.safety_warnings.length > 0 && (
        <View style={[cardStyles.card, cardStyles.warningCard]}>
          <Text style={cardStyles.warningTitle}>Safety warnings</Text>
          {d.safety_warnings.map((w, i) => (
            <Text key={i} style={cardStyles.warningItem}>
              {"\u26A0\uFE0F"} {w}
            </Text>
          ))}
        </View>
      )}

      {/* Professional */}
      {d.needs_professional && (
        <View style={[cardStyles.card, cardStyles.proCard]}>
          <Text style={cardStyles.proTitle}>Professional required</Text>
          {d.professional_type && (
            <Text style={cardStyles.proType}>
              Recommended specialist:{" "}
              <Text style={cardStyles.proTypeValue}>
                {d.professional_type.replace(/_/g, " ")}
              </Text>
            </Text>
          )}
        </View>
      )}

      {/* Disclaimer */}
      {d.disclaimer_required && (
        <Text style={cardStyles.disclaimer}>
          This is an AI-assisted assessment, not a licensed inspection. Always
          consult a qualified professional for safety-critical issues.
        </Text>
      )}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 20,
    gap: 12,
    ...shadow,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 20,
    ...shadow,
  },
  warningCard: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  proCard: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  subject: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.ink,
    lineHeight: 28,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  confidence: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: "500",
  },
  bodyText: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 23,
  },
  subheading: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 4,
  },
  bulletItem: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 22,
    paddingLeft: 4,
  },
  diffRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.danger,
    marginBottom: 8,
  },
  warningItem: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 22,
    marginBottom: 4,
  },
  proTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.warning,
    marginBottom: 6,
  },
  proType: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  proTypeValue: {
    fontWeight: "700",
    textTransform: "capitalize",
  },
  disclaimer: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
    textAlign: "center",
    fontStyle: "italic",
    paddingHorizontal: 8,
  },
});

// ── retake card ────────────────────────────────────────────────────────────

function RetakeCard({ analysis }: { analysis: Analysis }) {
  return (
    <View style={retakeStyles.card}>
      <Text style={retakeStyles.title}>Better photo needed</Text>
      <Text style={retakeStyles.note}>{analysis.note}</Text>
      {analysis.retake_guidance.length > 0 && (
        <View style={retakeStyles.tipsContainer}>
          <Text style={retakeStyles.tipsTitle}>Tips for a better photo:</Text>
          {analysis.retake_guidance.map((tip, i) => (
            <Text key={i} style={retakeStyles.tipItem}>
              {"\u2022"} {tip}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const retakeStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.large,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.warning,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.warning,
  },
  note: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  tipsContainer: {
    gap: 6,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 4,
  },
  tipItem: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 21,
    paddingLeft: 4,
  },
});

// ── cannot assess card ──────────────────────────────────────────────────────

function CannotAssessCard({ analysis }: { analysis: Analysis }) {
  return (
    <View style={cannotStyles.card}>
      <Text style={cannotStyles.title}>Unable to assess</Text>
      <Text style={cannotStyles.note}>{analysis.note}</Text>
    </View>
  );
}

const cannotStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 10,
    ...shadow,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.muted,
  },
  note: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
});

// ── main screen ────────────────────────────────────────────────────────────

export default function ResultScreen() {
  const router = useRouter();
  const { analysis, resetScan } = useScanFlow();

  useEffect(() => {
    if (analysis?.result_type === "questions") {
      router.replace("/follow-up");
    }
  }, [analysis, router]);

  if (!analysis) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No result available.</Text>
        <TouchableOpacity
          style={styles.newScanBtn}
          onPress={() => {
            resetScan();
            router.replace("/(tabs)/capture");
          }}
        >
          <Text style={styles.newScanBtnText}>Start a new scan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleNewScan() {
    resetScan();
    router.replace("/(tabs)/capture");
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {analysis.result_type === "diagnosis" && analysis.diagnosis && (
        <DiagnosisCard d={analysis.diagnosis} />
      )}

      {analysis.result_type === "retake" && <RetakeCard analysis={analysis} />}

      {analysis.result_type === "cannot_assess" && (
        <CannotAssessCard analysis={analysis} />
      )}

      {/* Note shown for all result types (when not in diagnosis hero) */}
      {analysis.result_type !== "diagnosis" && analysis.note && (
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>{analysis.note}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.newScanBtn}
        onPress={handleNewScan}
        activeOpacity={0.85}
      >
        <Text style={styles.newScanBtnText}>New scan</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 16,
  },
  cardGap: {
    gap: 12,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 20,
  },
  emptyText: {
    fontSize: 16,
    color: colors.muted,
    textAlign: "center",
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    padding: 16,
    ...shadow,
  },
  noteText: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  newScanBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: radius.medium,
    alignItems: "center",
    marginTop: 8,
    ...shadow,
  },
  newScanBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
