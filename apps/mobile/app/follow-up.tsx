import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useScanFlow } from "../src/state/ScanFlowContext";
import type { ScanAnswer } from "../src/lib/contract";
import { colors, radius, shadow } from "../src/theme";

export default function FollowUpScreen() {
  const router = useRouter();
  const { analysis, queueAnalysis } = useScanFlow();
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!analysis || analysis.result_type !== "questions") {
      router.back();
    }
  }, [analysis, router]);

  if (!analysis || analysis.result_type !== "questions") {
    return null;
  }

  const questions = analysis.follow_up_questions;

  function selectOption(questionId: string, option: string) {
    setSelections((prev) => ({ ...prev, [questionId]: option }));
  }

  function buildAnswers(): ScanAnswer[] {
    return questions
      .filter((q) => selections[q.id] !== undefined)
      .map((q) => ({
        question_id: q.id,
        question: q.question,
        answer: selections[q.id] ?? "",
      }));
  }

  function handleContinue() {
    const answers = buildAnswers();
    queueAnalysis(answers);
    router.replace("/analyzing");
  }

  function handleSkip() {
    queueAnalysis([]);
    router.replace("/analyzing");
  }

  const answeredCount = Object.keys(selections).length;
  const totalCount = questions.length;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>A few quick questions</Text>
        <Text style={styles.headerSub}>
          Your answers help FixSight give a more accurate diagnosis.
        </Text>
      </View>

      {/* Questions */}
      {questions.map((q, index) => (
        <View key={q.id} style={styles.questionCard}>
          <Text style={styles.questionNumber}>Question {index + 1} of {totalCount}</Text>
          <Text style={styles.questionText}>{q.question}</Text>
          {q.why_it_matters ? (
            <Text style={styles.whyText}>{q.why_it_matters}</Text>
          ) : null}
          <View style={styles.optionsContainer}>
            {q.options.map((option) => {
              const selected = selections[q.id] === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.optionChip, selected && styles.optionChipSelected]}
                  onPress={() => selectOption(q.id, option)}
                >
                  <View style={[styles.optionDot, selected && styles.optionDotSelected]} />
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            answeredCount === 0 && styles.continueBtnMuted,
          ]}
          onPress={handleContinue}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>
            {answeredCount > 0
              ? `Continue with ${answeredCount} answer${answeredCount !== 1 ? "s" : ""}`
              : "Continue"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={styles.skipBtnText}>Skip all questions</Text>
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
    padding: 20,
    paddingBottom: 48,
    gap: 16,
  },
  header: {
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 15,
    color: colors.muted,
    lineHeight: 22,
  },
  questionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 20,
    ...shadow,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  questionText: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
    lineHeight: 24,
    marginBottom: 8,
  },
  whyText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 16,
    fontStyle: "italic",
  },
  optionsContainer: {
    gap: 10,
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.medium,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
    gap: 10,
  },
  optionChipSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  optionDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  optionDotSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  optionText: {
    fontSize: 15,
    color: colors.ink,
    flex: 1,
    lineHeight: 20,
  },
  optionTextSelected: {
    fontWeight: "600",
    color: colors.brand,
  },
  actions: {
    marginTop: 8,
    gap: 12,
  },
  continueBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 16,
    borderRadius: radius.medium,
    alignItems: "center",
    ...shadow,
  },
  continueBtnMuted: {
    backgroundColor: colors.brand,
    opacity: 0.75,
  },
  continueBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  skipBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  skipBtnText: {
    fontSize: 15,
    color: colors.muted,
    fontWeight: "500",
  },
});
