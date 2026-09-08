import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ClassLegend } from "../components/ClassLegend";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { deleteInferenceJob, getSurvey } from "../lib/api";
import { PIXEL_DISCLAIMER } from "../lib/config";
import { getQueueForSurvey, removeFromQueue, syncQueue, type QueuedPart } from "../lib/offlineQueue";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { SurveyDetail, SurveyPart, SurveyVisit, VisionSession } from "../types";

function formatPct(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function emptySurveyDetail(surveyName: string): SurveyDetail {
  return {
    surveyName,
    partCount: 0,
    completedPartCount: 0,
    visitCount: 0,
    overallMeanCorrosionPercent: null,
    byClass: [],
    classNames: [],
    updatedAt: null,
    parts: [],
  };
}

function offlinePart(item: QueuedPart): SurveyPart {
  const visit: SurveyVisit = {
    inferenceId: item.id,
    status: "queued_offline",
    regionName: item.regionName,
    surveyName: item.surveyName,
    createdAt: item.createdAt,
    completedAt: null,
    imageCount: item.photos.length,
    meanCorrosionPercent: null,
    byClass: [],
    offline: true,
  };
  return {
    regionName: item.regionName,
    visitCount: 1,
    meanCorrosionPercent: null,
    imageCount: item.photos.length,
    byClass: [],
    latest: visit,
    latestCompleted: null,
    visits: [visit],
  };
}

function mergeOfflineParts(survey: SurveyDetail, queued: QueuedPart[]): SurveyDetail {
  if (queued.length === 0) return survey;
  const extra = queued.map(offlinePart);
  return { ...survey, partCount: survey.partCount + extra.length, parts: [...survey.parts, ...extra] };
}

export function SurveyDashboardScreen({
  session,
  projectName,
  surveyName,
  onBack,
  onAddPart,
  onOpenVisit,
}: {
  session: VisionSession;
  projectName: string;
  surveyName: string;
  onBack: () => void;
  onAddPart: () => void;
  onOpenVisit: (inferenceId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Pure fetch-and-merge, no sync attempt — this is what the auto-refresh
  // poll uses, so it just checks status without also hammering the upload
  // endpoint on every tick.
  const fetchSurvey = useCallback(async () => {
    setError(null);
    let base: SurveyDetail;
    let fetchError: string | null = null;
    try {
      base = await getSurvey(session, projectName, surveyName);
    } catch (err) {
      base = emptySurveyDetail(surveyName);
      fetchError = err instanceof Error ? err.message : "Could not load survey";
    }

    const queued = await getQueueForSurvey(projectName, surveyName);
    const merged = mergeOfflineParts(base, queued);
    setSurvey(merged);
    // Only block the screen with an error when there's truly nothing else to show —
    // if we have offline-queued parts, show those instead of a scary error.
    setError(fetchError && merged.parts.length === 0 ? fetchError : null);
    return merged;
  }, [session, projectName, surveyName]);

  const load = useCallback(async () => {
    await fetchSurvey();
    setLoading(false);

    // Best-effort: catch up any queued parts now that the screen is open.
    // Only happens here (mount/manual refresh), not on every auto-refresh tick.
    syncQueue(session)
      .then((result) => {
        if (result.uploaded > 0) fetchSurvey();
      })
      .catch(() => {});
  }, [fetchSurvey, session]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await syncQueue(session);
      if (result.error && result.remaining > 0) {
        Alert.alert(
          "Sync incomplete",
          `${result.error}${result.uploaded > 0 ? `\n\n${result.uploaded} part(s) did upload successfully.` : ""}`
        );
      }
    } catch (err) {
      Alert.alert("Sync failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSyncing(false);
      fetchSurvey();
    }
  };

  const deletePart = (part: SurveyPart) => {
    const isOffline = !!part.latest.offline;
    Alert.alert(
      "Delete this part?",
      isOffline
        ? `Remove the queued photos for "${part.regionName}" before they upload?`
        : `This permanently deletes all ${part.visitCount} visit(s) of "${part.regionName}". This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (isOffline) {
                await removeFromQueue(part.latest.inferenceId);
              } else {
                for (const visit of part.visits) {
                  await deleteInferenceJob(session, visit.inferenceId);
                }
              }
              load();
            } catch (err) {
              Alert.alert(
                "Delete failed",
                err instanceof Error ? err.message : "Some items could not be deleted."
              );
            }
          },
        },
      ]
    );
  };

  const pendingCount = survey?.parts.filter((p) => p.latest.offline).length ?? 0;
  const hasActiveJob = survey?.parts.some((p) => ["queued", "running"].includes(p.latest.status)) ?? false;

  // Auto-refresh while any part is still queued/running server-side, so
  // results appear without the user having to leave and reopen this screen.
  // Must be setInterval, not setTimeout: hasActiveJob stays `true` across
  // renders while a job runs, so a dependency-triggered setTimeout would
  // never re-arm — setInterval keeps ticking on its own until cleared.
  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(fetchSurvey, 4000);
    return () => clearInterval(interval);
  }, [hasActiveJob, fetchSurvey]);

  return (
    <View style={styles.root}>
      <NauticalBackground
        icons={[
          { name: "anchor", size: 220, opacity: 0.12, style: { bottom: -40, right: -50, transform: [{ rotate: "-10deg" }] } },
          { name: "waves", size: 140, opacity: 0.13, style: { top: 100, left: -40 } },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Surveys</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <ThemeToggle />
          <Pressable onPress={onAddPart} style={styles.linkRow}>
            <Ionicons name="add-circle-outline" size={18} color={colors.accentText} />
            <Text style={styles.link}>Part</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.title}>{surveyName}</Text>
      <Text style={styles.hint}>{PIXEL_DISCLAIMER} Whole-ship % is the average of each part’s latest visit.</Text>

      {loading && !survey ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : error ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Ionicons name="refresh" size={14} color={colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        >
          {pendingCount > 0 ? (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>
                {pendingCount} part{pendingCount === 1 ? "" : "s"} waiting to upload
              </Text>
              <Pressable style={styles.syncBtn} onPress={syncNow} disabled={syncing}>
                {syncing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={14} color="#fff" />
                    <Text style={styles.syncBtnText}>Sync now</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          <View style={styles.batch}>
            <View style={styles.batchLabelRow}>
              <MaterialCommunityIcons name="ferry" size={16} color={colors.accentText} />
              <Text style={styles.batchLabel}>Whole ship (this survey)</Text>
            </View>
            <Text style={styles.batchValue}>{formatPct(survey?.overallMeanCorrosionPercent)}</Text>
            <Text style={styles.batchMeta}>
              {survey?.completedPartCount ?? 0} of {survey?.partCount ?? 0} parts have a completed inspect
            </Text>
            <ClassLegend items={survey?.byClass} classNames={survey?.classNames} showStats />
          </View>

          <Pressable style={styles.primary} onPress={onAddPart}>
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={styles.primaryText}>Inspect next part</Text>
          </Pressable>

          <Text style={styles.section}>Parts</Text>
          {!survey?.parts.length ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={28} color={colors.textMuted} />
              <Text style={styles.empty}>No parts yet. Walk to an area, name it, and upload photos.</Text>
            </View>
          ) : (
            survey.parts.map((part) => {
              const openId = part.latestCompleted?.inferenceId || part.latest.inferenceId;
              const canOpen = part.latestCompleted || part.latest.status === "completed";
              const isOffline = !!part.latest.offline;
              const isProcessing = !isOffline && ["queued", "running"].includes(part.latest.status);
              return (
                <Pressable
                  key={part.latest.inferenceId || part.regionName}
                  style={styles.row}
                  onPress={() => canOpen && onOpenVisit(openId)}
                >
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowTitle}>{part.regionName}</Text>
                    <Pressable hitSlop={10} onPress={() => deletePart(part)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  {isProcessing ? (
                    <View style={styles.processingRow}>
                      <ActivityIndicator color={colors.accentText} size="small" />
                      <Text style={styles.processingText}>
                        {part.latest.status === "queued" ? "Queued for inspection…" : "Inspecting…"}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.partPct, isOffline && styles.partPctPending]}>
                      {isOffline ? "Pending" : formatPct(part.meanCorrosionPercent)}
                    </Text>
                  )}
                  <Text style={styles.rowMeta}>
                    {isOffline
                      ? "Queued — waiting to upload"
                      : isProcessing
                        ? "This can take a moment — updates automatically"
                        : `Latest ${part.latest.status}`}
                    {part.visitCount > 1 ? ` · ${part.visitCount} visits` : ""}
                    {part.imageCount ? ` · ${part.imageCount} photo(s)` : ""}
                  </Text>
                  {canOpen ? <Text style={styles.openHint}>Tap to view this part’s photos</Text> : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
    linkRow: { flexDirection: "row", alignItems: "center" },
    link: { color: colors.accentText, fontWeight: "600" },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: "700" },
    hint: { color: colors.textSecondary, marginTop: 8, marginBottom: 16, lineHeight: 20 },
    error: { color: colors.danger },
    retry: {
      marginTop: 12,
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    retryText: { color: colors.textPrimary, fontWeight: "600" },
    emptyWrap: { alignItems: "center", marginTop: 12, marginBottom: 12, gap: 10 },
    empty: { color: colors.textMuted, textAlign: "center", lineHeight: 20 },
    offlineBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    offlineBannerText: { color: colors.textPrimary, fontWeight: "600", flex: 1, marginRight: 10 },
    syncBtn: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 84,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    syncBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
    batch: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    batchLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    batchLabel: { color: colors.textSecondary, fontSize: 12 },
    batchValue: { color: colors.textPrimary, fontSize: 32, fontWeight: "700", marginTop: 4 },
    batchMeta: { color: colors.textMuted, marginTop: 4, marginBottom: 8 },
    primary: {
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginBottom: 20,
    },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    section: { color: colors.textPrimary, fontWeight: "700", marginBottom: 10 },
    row: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    deleteBtn: { padding: 2 },
    rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", flex: 1, marginRight: 8 },
    partPct: { color: colors.accentText, fontSize: 22, fontWeight: "700", marginTop: 4 },
    partPctPending: { color: colors.textSecondary, fontSize: 16 },
    processingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    processingText: { color: colors.accentText, fontWeight: "700", fontSize: 15 },
    rowMeta: { color: colors.textSecondary, marginTop: 4, fontSize: 13 },
    openHint: { color: colors.textMuted, marginTop: 6, fontSize: 12 },
  });
}
