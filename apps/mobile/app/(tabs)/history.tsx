import { useQuery } from "@tanstack/react-query";
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { listHistory } from "../../src/lib/history";
import type { HistoryRecord } from "../../src/lib/history";
import { colors, radius, shadow } from "../../src/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SeverityBadge({ severity }: { severity: number }) {
  const color = severity >= 7 ? colors.danger : severity >= 4 ? colors.warning : colors.brand;
  const bg =
    severity >= 7 ? colors.dangerSoft : severity >= 4 ? colors.warningSoft : colors.brandSoft;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{severity}/10</Text>
    </View>
  );
}

function HistoryItem({ record, onPress }: { record: HistoryRecord; onPress: () => void }) {
  const d = record.analysis.diagnosis;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <Image source={{ uri: record.thumbnailUri }} style={styles.thumb} />
      <View style={styles.info}>
        <Text style={styles.category} numberOfLines={1}>
          {record.category ?? "General inspection"}
        </Text>
        <Text style={styles.date}>{formatDate(record.createdAt)}</Text>
        {d && (
          <Text style={styles.diagText} numberOfLines={2}>
            {d.diagnosis}
          </Text>
        )}
      </View>
      <View style={styles.right}>
        {d && <SeverityBadge severity={d.severity} />}
        {record.resolved && <Text style={styles.resolvedTag}>Resolved</Text>}
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: listHistory,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (records.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📷</Text>
        <Text style={styles.emptyTitle}>No scans yet</Text>
        <Text style={styles.muted}>Go to the Scan tab to analyze your first home issue.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={records}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <HistoryItem
          record={item}
          onPress={() =>
            router.push({ pathname: "/history/[id]", params: { id: item.id } })
          }
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    overflow: "hidden",
    ...shadow,
  },
  thumb: { width: 80, height: 80 },
  info: { flex: 1, padding: 12 },
  category: { fontSize: 15, fontWeight: "600", color: colors.ink },
  date: { fontSize: 12, color: colors.muted, marginTop: 2 },
  diagText: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
  right: { padding: 10, alignItems: "flex-end", justifyContent: "center", gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.small },
  badgeText: { fontSize: 12, fontWeight: "700" },
  resolvedTag: { fontSize: 11, color: colors.brand, fontWeight: "600" },
  center: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.ink, marginBottom: 8 },
  muted: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20 },
});
