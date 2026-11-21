import { StyleSheet, Text, View } from "react-native";
import type { Diagnosis } from "../lib/contract";
import { colors, radius, shadow } from "../theme";

const LIKELIHOOD: Record<string, string> = {
  most_likely: "Most likely",
  possible: "Possible",
  less_likely: "Less likely",
};

function money(range: { low: number; high: number } | null): string | null {
  if (!range) return null;
  const format = (value: number) => `$${value.toLocaleString("en-US")}`;
  return range.low === range.high ? format(range.low) : `${format(range.low)}–${format(range.high)}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((item, index) => (
        <Text key={index} style={styles.bullet}>{"•"} {item}</Text>
      ))}
    </>
  );
}

/** Immediate-safety notices that apply to any result type. */
export function SafetyNotices({ notices }: { notices: readonly string[] }) {
  if (!notices.length) return null;
  return (
    <View style={[styles.card, styles.danger]} accessibilityRole="alert">
      <Text style={[styles.title, styles.dangerTitle]}>Safety first</Text>
      <Bullets items={notices} />
    </View>
  );
}

/**
 * The contract v5 sections: what was seen versus what might explain it, what a
 * photo cannot show, the steps, and the planning estimates. Records saved
 * before v5 have empty lists and render nothing extra.
 */
export function V5Details({ d }: { d: Diagnosis }) {
  const cost = d.cost_estimate;
  const diy = money(cost.diy_materials);
  const pro = money(cost.professional_total);
  const labor = d.labor_estimate;
  return (
    <View style={styles.stack}>
      {d.observations.length > 0 && (
        <Card title="What the photos show"><Bullets items={d.observations} /></Card>
      )}
      {d.possible_causes.length > 0 && (
        <Card title="Possible causes (not confirmed)">
          {d.possible_causes.map((cause, index) => (
            <View key={index} style={styles.cause}>
              <Text style={styles.likelihood}>{LIKELIHOOD[cause.likelihood] ?? cause.likelihood}</Text>
              <Text style={styles.body}><Text style={styles.strong}>{cause.cause}</Text> — {cause.supporting_evidence}</Text>
            </View>
          ))}
        </Card>
      )}
      {d.limitations.length > 0 && (
        <Card title="What a photo can't tell us"><Bullets items={d.limitations} /></Card>
      )}
      {d.recommendation.repair_steps.length > 0 && (
        <Card title="Step-by-step repair">
          {d.recommendation.repair_steps.map((step, index) => (
            <Text key={index} style={styles.bullet}><Text style={styles.strong}>{index + 1}.</Text> {step}</Text>
          ))}
        </Card>
      )}
      {d.next_inspection_steps.length > 0 && (
        <Card title="Next things to check"><Bullets items={d.next_inspection_steps} /></Card>
      )}
      {(diy || pro || labor) && (
        <Card title="Estimated cost & labor">
          {diy && <Text style={styles.body}>DIY materials: <Text style={styles.strong}>{diy}</Text></Text>}
          {pro && <Text style={styles.body}>Professional (typical): <Text style={styles.strong}>{pro}</Text></Text>}
          {labor && (
            <Text style={styles.body}>
              Hands-on time: <Text style={styles.strong}>{labor.hours_low}–{labor.hours_high} h</Text> ({labor.who})
            </Text>
          )}
          <Text style={styles.note}>Planning ranges, not a quote.</Text>
          <Bullets items={[...cost.assumptions, ...(labor?.assumptions ?? [])]} />
        </Card>
      )}
      {d.maintenance_tips.length > 0 && (
        <Card title="Prevent it next time"><Bullets items={d.maintenance_tips} /></Card>
      )}
      {d.follow_up && (
        <Card title="Follow-up check">
          <Text style={styles.body}>
            Look again in <Text style={styles.strong}>{d.follow_up.reinspect_in_days} days</Text>: {d.follow_up.what_to_check}
          </Text>
        </Card>
      )}
      {d.additional_photos.length > 0 && (
        <Card title="Photos that would help"><Bullets items={d.additional_photos} /></Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius.large, padding: 20, gap: 6, ...shadow },
  danger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  title: { fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  dangerTitle: { color: colors.danger },
  body: { fontSize: 15, color: colors.ink, lineHeight: 23 },
  bullet: { fontSize: 15, color: colors.ink, lineHeight: 23, paddingLeft: 2 },
  strong: { fontWeight: "700" },
  note: { fontSize: 12, color: colors.muted, marginTop: 6 },
  cause: { gap: 2, marginBottom: 6 },
  likelihood: { alignSelf: "flex-start", fontSize: 11, fontWeight: "800", color: colors.brand, backgroundColor: colors.brandSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: "hidden" },
});
