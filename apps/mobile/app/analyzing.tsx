import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useScanFlow } from "../src/state/ScanFlowContext";
import { colors, radius } from "../src/theme";

export default function AnalyzingScreen() {
  const router = useRouter();
  const { runQueuedAnalysis, error, phase } = useScanFlow();
  const [localError, setLocalError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    runQueuedAnalysis()
      .then((analysis) => {
        if (analysis.result_type === "questions") {
          router.replace("/follow-up");
        } else {
          router.replace("/result");
        }
      })
      .catch((err: unknown) => {
        setLocalError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, []); // intentional empty deps - run once on mount

  const displayError = localError ?? error;

  if (displayError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Analysis failed</Text>
        <Text style={styles.errorText}>{displayError}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
          <Text style={styles.btnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text style={styles.label}>Analyzing your photo…</Text>
      <Text style={styles.sub}>This usually takes 10–30 seconds</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  label: {
    marginTop: 24,
    fontSize: 18,
    fontWeight: "600",
    color: colors.ink,
  },
  sub: {
    marginTop: 8,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.danger,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 15,
    color: colors.ink,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: radius.medium,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
