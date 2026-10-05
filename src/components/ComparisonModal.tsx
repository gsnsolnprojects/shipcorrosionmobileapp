import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthImage } from "./AuthImage";
import { apiUrl } from "../lib/config";
import { getInspectionComparison } from "../lib/api";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { CompareResult, VisionSession } from "../types";

function formatPct(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function photoUrl(inferenceId: string, filename: string): string {
  return apiUrl(`/inference/${encodeURIComponent(inferenceId)}/image/${encodeURIComponent(filename)}`);
}

/** Baseline-vs-current photo comparison for a resurveyed part — the mobile counterpart to the web dashboard's Compare dialog. */
export function ComparisonModal({
  session,
  currentInferenceId,
  onClose,
}: {
  session: VisionSession;
  currentInferenceId: string | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The earlier visit chosen from the "compare against" chips; only valid for the visit it was picked on.
  const [pick, setPick] = useState<{ forId: string | null; baselineId?: string }>({ forId: null });
  const baselineId = pick.forId === currentInferenceId ? pick.baselineId : undefined;

  useEffect(() => {
    if (!currentInferenceId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInspectionComparison(session, currentInferenceId, baselineId)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load comparison.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, currentInferenceId, baselineId]);

  const otherVisits = result?.observationVisits.filter((v) => v.inferenceId !== currentInferenceId) ?? [];

  return (
    <Modal visible={!!currentInferenceId} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Before / after</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : result ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {otherVisits.length > 1 ? (
              <>
                <Text style={styles.chipsLabel}>Compare against</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {otherVisits.map((v) => {
                    const active = v.inferenceId === result.baseline.inferenceId;
                    return (
                      <Pressable
                        key={v.inferenceId}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setPick({ forId: currentInferenceId, baselineId: v.inferenceId })}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {new Date(v.createdAt).toLocaleDateString()} · {formatPct(v.meanCorrosionPercent)}
                          {v.baselineKind ? " · Baseline" : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            {result.pairing === "by_order" ? (
              <Text style={styles.orderNote}>
                These visits weren't a guided resurvey, so photos are paired by the order they were taken and may not
                show exactly the same spot.
              </Text>
            ) : null}

            {result.review ? (
              <View
                style={[
                  styles.reviewBox,
                  {
                    borderColor:
                      result.review.verdict === "worse"
                        ? colors.danger
                        : result.review.verdict === "better"
                          ? colors.success
                          : colors.surfaceBorder,
                  },
                ]}
              >
                <Text style={styles.reviewTitle}>
                  {result.review.verdict === "worse"
                    ? "Reviewer: confirmed deterioration"
                    : result.review.verdict === "better"
                      ? "Reviewer: improved"
                      : "Reviewer: no change"}
                </Text>
                {result.review.note ? <Text style={styles.reviewNote}>{result.review.note}</Text> : null}
                <Text style={styles.reviewMeta}>
                  {result.review.reviewedBy || "reviewer"}
                  {result.review.reviewedAt ? `, ${new Date(result.review.reviewedAt).toLocaleDateString()}` : ""}
                </Text>
              </View>
            ) : null}

            <View style={styles.summary}>
              <Text style={styles.summaryLine}>
                {result.baseline.surveyName} → {result.current.surveyName}
              </Text>
              <Text style={styles.summaryPct}>
                {formatPct(result.baseline.meanCorrosionPercent)} → {formatPct(result.current.meanCorrosionPercent)}
              </Text>
              {typeof result.overallDelta === "number" ? (
                <Text
                  style={[
                    styles.summaryDelta,
                    { color: result.overallDelta > 0 ? colors.danger : colors.success },
                  ]}
                >
                  {result.overallDelta > 0 ? "+" : ""}
                  {result.overallDelta.toFixed(2)}% vs baseline
                </Text>
              ) : null}
            </View>

            {result.pairs.length > 0 ? (
              <>
                <Text style={styles.section}>{result.pairing === "matched" ? "Matched photos" : "Photos side by side"}</Text>
                {result.pairs.map((pair) => (
                  <View key={pair.currentFilename} style={styles.pairRow}>
                    <View style={styles.pairCol}>
                      <Text style={styles.pairLabel}>Before · {formatPct(pair.baselinePercent)}</Text>
                      <AuthImage url={photoUrl(result.baseline.inferenceId, pair.baselineFilename)} session={session} height={140} />
                    </View>
                    <View style={styles.pairCol}>
                      <Text style={styles.pairLabel}>After · {formatPct(pair.currentPercent)}</Text>
                      <AuthImage url={photoUrl(result.current.inferenceId, pair.currentFilename)} session={session} height={140} />
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {result.extraCurrent.length > 0 ? (
              <>
                <Text style={styles.section}>New this cycle</Text>
                <View style={styles.grid}>
                  {result.extraCurrent.map((img) => (
                    <View key={img.filename} style={styles.gridItem}>
                      <Text style={styles.pairLabel}>{formatPct(img.percent)}</Text>
                      <AuthImage url={photoUrl(result.current.inferenceId, img.filename)} session={session} height={110} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {result.unmatchedBaseline.length > 0 ? (
              <>
                <Text style={styles.section}>Not re-photographed this cycle</Text>
                <View style={styles.grid}>
                  {result.unmatchedBaseline.map((img) => (
                    <View key={img.filename} style={[styles.gridItem, styles.dimmed]}>
                      <Text style={styles.pairLabel}>{formatPct(img.percent)}</Text>
                      <AuthImage url={photoUrl(result.baseline.inferenceId, img.filename)} session={session} height={110} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 56 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    title: { color: colors.textPrimary, fontSize: 20, fontWeight: "700" },
    error: { color: colors.danger, marginTop: 24, textAlign: "center" },
    summary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 12,
      padding: 14,
      marginBottom: 18,
    },
    summaryLine: { color: colors.textSecondary, fontSize: 13 },
    summaryPct: { color: colors.textPrimary, fontSize: 20, fontWeight: "700", marginTop: 4 },
    summaryDelta: { fontSize: 13, fontWeight: "700", marginTop: 4 },
    section: { color: colors.textPrimary, fontWeight: "700", marginTop: 8, marginBottom: 10 },
    chipsLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 6 },
    chips: { gap: 8, paddingBottom: 12 },
    chip: { borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: "600" },
    chipTextActive: { color: "#fff" },
    orderNote: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
    },
    reviewBox: {
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
    },
    reviewTitle: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
    reviewNote: { color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
    reviewMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
    pairRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    pairCol: { flex: 1, gap: 6 },
    pairLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    gridItem: { width: "47%", gap: 6 },
    dimmed: { opacity: 0.6 },
  });
}
