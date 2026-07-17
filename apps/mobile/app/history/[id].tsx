import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getHistoryScan, setHistoryResolved } from "../../src/lib/history";
import type { Diagnosis } from "../../src/lib/contract";
import { useScanFlow } from "../../src/state/ScanFlowContext";
import { colors, radius, shadow } from "../../src/theme";

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.container}>
      <Text style={sectionStyles.title}>{title}</Text>
      {children}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: { gap: 8 },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});

function DiagnosisDetail({ d }: { d: Diagnosis }) {
  const urgencyC = urgencyColors(d.urgency);
  const diffC = difficultyColors(d.recommendation.difficulty);

  return (
    <View style={styles.cardStack}>
      {/* Hero */}
      <View style={styles.heroCard}>
        <Text style={styles.subject}>{d.subject}</Text>
        <View style={styles.metaRow}>
          <Badge label={urgencyLabel(d.urgency)} bg={urgencyC.bg} fg={urgencyC.fg} />
          <Text style={styles.confidence}>{Math.round(d.confidence * 100)}% confidence</Text>
        </View>
        <SeverityBar severity={d.severity} />
      </View>

      {/* Diagnosis */}
      <View style={styles.card}>
        <Section title="Diagnosis">
          <Text style={styles.bodyText}>{d.diagnosis}</Text>
        </Section>
      </View>

      {/* Cause */}
      <View style={styles.card}>
        <Section title="Likely Cause">
          <Text style={styles.bodyText}>{d.likely_cause}</Text>
        </Section>
      </View>

      {/* Recommendations */}
      <View style={styles.card}>
        <Section title="Recommended Fix">
          <Text style={styles.subheading}>Best fix</Text>
          <Text style={styles.bodyText}>{d.recommendation.best_fix}</Text>
          <Text style={[styles.subheading, { marginTop: 12 }]}>Cheap or temporary fix</Text>
          <Text style={styles.bodyText}>{d.recommendation.cheap_or_temp_fix}</Text>
          {d.recommendation.tools_or_parts.length > 0 && (
            <>
              <Text style={[styles.subheading, { marginTop: 12 }]}>Tools / Parts needed</Text>
              {d.recommendation.tools_or_parts.map((item, i) => (
                <Text key={i} style={styles.bulletItem}>
                  {"\u2022"} {item}
                </Text>
              ))}
            </>
          )}
          <View style={styles.diffRow}>
            <Badge label={difficultyLabel(d.recommendation.difficulty)} bg={diffC.bg} fg={diffC.fg} />
            <Badge
              label={d.safe_to_diy ? "Safe to DIY" : "Not safe for DIY"}
              bg={d.safe_to_diy ? colors.brandSoft : colors.dangerSoft}
              fg={d.safe_to_diy ? colors.brand : colors.danger}
            />
          </View>
        </Section>
      </View>

      {/* Risk if ignored */}
      <View style={styles.card}>
        <Section title="Risk if Ignored">
          <Text style={styles.bodyText}>{d.risk_if_ignored}</Text>
        </Section>
      </View>

      {/* Safety warnings */}
      {d.safety_warnings.length > 0 && (
        <View style={[styles.card, styles.warningCard]}>
          <Text style={styles.warningTitle}>Safety warnings</Text>
          {d.safety_warnings.map((w, i) => (
            <Text key={i} style={styles.warningItem}>
              {"\u26A0\uFE0F"} {w}
            </Text>
          ))}
        </View>
      )}

      {/* Professional */}
      {d.needs_professional && (
        <View style={[styles.card, styles.proCard]}>
          <Text style={styles.proTitle}>Professional required</Text>
          {d.professional_type && (
            <Text style={styles.proType}>
              Recommended specialist:{" "}
              <Text style={styles.proTypeValue}>
                {d.professional_type.replace(/_/g, " ")}
              </Text>
            </Text>
          )}
        </View>
      )}

      {d.disclaimer_required && (
        <Text style={styles.disclaimer}>
          This is an AI-assisted assessment, not a licensed inspection. Always
          consult a qualified professional for safety-critical issues.
        </Text>
      )}
    </View>
  );
}

// ── main screen ────────────────────────────────────────────────────────────

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { startReinspection } = useScanFlow();

  const { data: record, isLoading } = useQuery({
    queryKey: ["history", id],
    queryFn: () => getHistoryScan(id),
    enabled: Boolean(id),
  });

  async function handleToggleResolved() {
    if (!record) return;
    await setHistoryResolved(record.id, !record.resolved);
    await queryClient.invalidateQueries({ queryKey: ["history"] });
    await queryClient.invalidateQueries({ queryKey: ["history", id] });
  }

  function handleReinspect() {
    if (!record) return;
    startReinspection(record);
    router.push("/(tabs)/capture");
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!record) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundText}>Scan not found.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = record.analysis.diagnosis;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Meta */}
      <View style={styles.metaCard}>
        <Text style={styles.metaCategory}>
          {record.category ?? "General inspection"}
        </Text>
        <Text style={styles.metaDate}>{formatDate(record.createdAt)}</Text>
        {record.resolved && (
          <View style={styles.resolvedBadge}>
            <Text style={styles.resolvedBadgeText}>Resolved</Text>
          </View>
        )}
      </View>

      {/* Diagnosis content */}
      {d && <DiagnosisDetail d={d} />}

      {!d && (
        <View style={styles.card}>
          <Text style={styles.bodyText}>{record.analysis.note}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.resolveBtn, record.resolved && styles.resolveBtnOpen]}
          onPress={handleToggleResolved}
          activeOpacity={0.85}
        >
          <Text style={[styles.resolveBtnText, record.resolved && styles.resolveBtnTextOpen]}>
            {record.resolved ? "Mark as open" : "Mark as resolved"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reinspectBtn}
          onPress={handleReinspect}
          activeOpacity={0.85}
        >
          <Text style={styles.reinspectBtnText}>Reinspect this area</Text>
        </TouchableOpacity>
      </View>
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
    gap: 12,
  },
  center: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 20,
  },
  notFoundText: {
    fontSize: 16,
    color: colors.muted,
  },
  backBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.medium,
  },
  backBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  // Meta card
  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 16,
    gap: 4,
    ...shadow,
  },
  metaCategory: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
  },
  metaDate: {
    fontSize: 13,
    color: colors.muted,
  },
  resolvedBadge: {
    backgroundColor: colors.brandSoft,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    marginTop: 6,
  },
  resolvedBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
  },
  // Diagnosis card layout
  cardStack: {
    gap: 12,
  },
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
  // Actions
  actions: {
    gap: 12,
    marginTop: 8,
  },
  resolveBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 15,
    borderRadius: radius.medium,
    alignItems: "center",
    ...shadow,
  },
  resolveBtnOpen: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brand,
    shadowOpacity: 0,
    elevation: 0,
  },
  resolveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  resolveBtnTextOpen: {
    color: colors.brand,
  },
  reinspectBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 15,
    borderRadius: radius.medium,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  reinspectBtnText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "600",
  },
});
