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
import { ComparisonModal } from "../components/ComparisonModal";
import { NauticalBackground } from "../components/NauticalBackground";
import { ResurveyStartModal } from "../components/ResurveyStartModal";
import { ShipZoneMap } from "../components/ShipZoneMap";
import { ThemeToggle } from "../components/ThemeToggle";
import { deleteInferenceJob, getRegionsAwaitingResurvey, getSurvey } from "../lib/api";
import {
  enqueueAppendResult,
  enqueueOnDeviceResult,
  getQueueForSurvey,
  removeFromQueue,
  syncQueue,
  type QueuedOnDevicePart,
  type QueuedPart,
  type QueuedUploadPart,
} from "../lib/offlineQueue";
import { CORROSION_CLASS_NAMES, runOnDeviceInspection } from "../lib/onDeviceInference";
import { assessmentSummary } from "../lib/assessment";
import { COMMON_SHIP_AREAS } from "../lib/shipAreas";
import { deriveSeverityBand, severityColor } from "../lib/severity";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import { partLabel, type InspectResults, type SurveyDetail, type SurveyPart, type SurveyVisit, type VisionSession } from "../types";

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

function offlinePart(item: QueuedUploadPart | QueuedOnDevicePart): SurveyPart {
  // An on-device-confirmed part queued offline already has real computed
  // stats (nothing left to infer) — a plain queued upload doesn't yet.
  const imageCount = item.kind === "on_device" ? item.images.length : item.photos.length;
  const meanCorrosionPercent = item.kind === "on_device" ? item.meanCorrosionPercent : null;
  const byClass = item.kind === "on_device" ? item.byClass : [];
  const visit: SurveyVisit = {
    inferenceId: item.id,
    status: "queued_offline",
    regionName: item.regionName,
    surveyName: item.surveyName,
    createdAt: item.createdAt,
    completedAt: null,
    imageCount,
    meanCorrosionPercent,
    byClass,
    offline: true,
    componentName: item.componentName || "",
    notes: item.notes || "",
  };
  return {
    partKey: item.id,
    regionName: item.regionName,
    componentName: item.componentName || "",
    observationId: null,
    inspectorName: null,
    notes: item.notes || "",
    visitCount: 1,
    meanCorrosionPercent,
    imageCount,
    byClass,
    latest: visit,
    latestCompleted: null,
    visits: [visit],
  };
}

function mergeOfflineParts(survey: SurveyDetail, queued: QueuedPart[]): SurveyDetail {
  if (queued.length === 0) return survey;

  // A queued "append" targets an already-existing part's job — fold it into
  // that part's row (as a pending-photos count) instead of showing it as a
  // separate duplicate part, which "upload"/"on_device" entries still do
  // (those really are new, not-yet-synced parts).
  const pendingAppends = new Map<string, number>();
  for (const item of queued) {
    if (item.kind === "append") {
      pendingAppends.set(item.regionName, (pendingAppends.get(item.regionName) || 0) + item.images.length);
    }
  }
  const parts =
    pendingAppends.size > 0
      ? survey.parts.map((p) =>
          pendingAppends.has(p.regionName) ? { ...p, pendingAppendCount: pendingAppends.get(p.regionName) } : p
        )
      : survey.parts;

  const extra = queued
    .filter((p): p is QueuedUploadPart | QueuedOnDevicePart => p.kind !== "append")
    .map(offlinePart);
  if (extra.length === 0) return { ...survey, parts };
  return { ...survey, partCount: survey.partCount + extra.length, parts: [...parts, ...extra] };
}

export function SurveyDashboardScreen({
  session,
  projectName,
  surveyName,
  onBack,
  onAddPart,
  onAddPartWithArea,
  onAddPhotosToPart,
  onEditQueuedPart,
  onOpenVisit,
  onStartResurvey,
}: {
  session: VisionSession;
  projectName: string;
  surveyName: string;
  onBack: () => void;
  onAddPart: () => void;
  onAddPartWithArea: (area: string) => void;
  onAddPhotosToPart: (area: string, targetInferenceId: string) => void;
  onEditQueuedPart: (area: string, queuedPartId: string) => void;
  onOpenVisit: (inferenceId: string) => void;
  onStartResurvey: (area: string, baselineInferenceId: string, targetSurveyName: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [resurveyPart, setResurveyPart] = useState<SurveyPart | null>(null);
  // Region names with a repair closed on the web dashboard but not yet
  // confirmed by a resurvey here — best-effort, never blocks the screen.
  const [regionsAwaitingResurvey, setRegionsAwaitingResurvey] = useState<Set<string>>(new Set());
  const [compareInferenceId, setCompareInferenceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Only "upload" (raw photos) queue entries have anything left to run —
  // "on_device" entries already have computed results waiting to sync.
  const [queuedUploads, setQueuedUploads] = useState<QueuedUploadPart[]>([]);
  const [runningLocally, setRunningLocally] = useState(false);

  // Merges a survey detail with offline-queued parts and renders — pulled
  // out of fetchSurvey() so the stale-while-revalidate background refresh
  // (see getSurvey's onFresh below) can re-render once fresh data arrives
  // without re-triggering another network fetch.
  const renderSurvey = useCallback(
    async (base: SurveyDetail) => {
      const queued = await getQueueForSurvey(projectName, surveyName);
      setQueuedUploads(queued.filter((p): p is QueuedUploadPart => p.kind === "upload"));
      const merged = mergeOfflineParts(base, queued);
      setSurvey(merged);
      return merged;
    },
    [projectName, surveyName]
  );

  // Pure fetch-and-merge, no sync attempt — this is what the auto-refresh
  // poll uses, so it just checks status without also hammering the upload
  // endpoint on every tick.
  const fetchSurvey = useCallback(async () => {
    setError(null);
    let base: SurveyDetail;
    let fetchError: string | null = null;
    try {
      // Returns cached data immediately if there is any — onFresh re-renders
      // later if a background network refresh succeeds, without blocking
      // this screen on the network at all.
      base = await getSurvey(session, projectName, surveyName, (fresh) => {
        renderSurvey(fresh);
      });
    } catch (err) {
      base = emptySurveyDetail(surveyName);
      fetchError = err instanceof Error ? err.message : "Could not load survey";
    }

    const merged = await renderSurvey(base);
    // Only block the screen with an error when there's truly nothing else to show —
    // if we have offline-queued parts, show those instead of a scary error.
    setError(fetchError && merged.parts.length === 0 ? fetchError : null);
    return merged;
  }, [session, projectName, surveyName, renderSurvey]);

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

    // Best-effort: surface repairs closed on the web dashboard that haven't
    // been confirmed by a resurvey yet.
    getRegionsAwaitingResurvey(session, projectName)
      .then(setRegionsAwaitingResurvey)
      .catch(() => {});
  }, [fetchSurvey, session, projectName]);

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

  // Runs the on-device model on every queued "upload" part's photos, right
  // now, no network needed — turns a plain queued-photos entry into a
  // queued on_device entry with real computed stats, same as if the user
  // had tapped "Inspect on-device" for it live. Syncing later then just
  // uploads these already-computed results, same as any other on-device part.
  const runLocally = async () => {
    if (queuedUploads.length === 0) return;
    setRunningLocally(true);
    let failed = 0;
    try {
      for (const part of queuedUploads) {
        try {
          const batch = await runOnDeviceInspection(part.photos);
          const results: InspectResults = {
            inferenceId: `ondevice_${Date.now()}`,
            regionName: part.regionName,
            surveyName: part.surveyName,
            images: batch.images,
            batch: {
              imageCount: part.photos.length,
              meanCorrosionPercent: batch.meanCorrosionPercent ?? undefined,
              byClass: batch.byClass,
              classNames: [...CORROSION_CLASS_NAMES],
            },
            classNames: [...CORROSION_CLASS_NAMES],
          };
          await enqueueOnDeviceResult({
            companyId: part.companyId,
            companyName: part.companyName,
            projectName: part.projectName,
            surveyName: part.surveyName,
            regionName: part.regionName,
            results,
          });
          await removeFromQueue(part.id);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        Alert.alert(
          "Some parts failed",
          `${failed} part(s) could not be inspected on-device and will stay queued for upload instead.`
        );
      }
    } finally {
      setRunningLocally(false);
      fetchSurvey();
    }
  };

  const deletePart = (part: SurveyPart) => {
    const isOffline = !!part.latest.offline;
    Alert.alert(
      "Delete this part?",
      isOffline
        ? `Remove the queued photos for "${partLabel(part)}" before they upload?`
        : `This permanently deletes "${partLabel(part)}" and all its photos. This cannot be undone.`,
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

  const resurveyedCount = survey?.parts.filter((p) => !!p.latestCompleted?.baselineInferenceId).length ?? 0;
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
      <Text style={styles.hint}>Whole-ship % is the average of each part’s %.</Text>

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
              <View style={styles.offlineBannerActions}>
                {queuedUploads.length > 0 ? (
                  <Pressable
                    style={styles.localBtn}
                    onPress={runLocally}
                    disabled={runningLocally || syncing}
                  >
                    {runningLocally ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      <>
                        <Ionicons name="hardware-chip-outline" size={14} color={colors.accent} />
                        <Text style={styles.localBtnText}>Run locally</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
                <Pressable style={styles.syncBtn} onPress={syncNow} disabled={syncing || runningLocally}>
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
            {resurveyedCount > 0 ? (
              <View style={styles.resurveySummaryRow}>
                <Ionicons name="repeat" size={13} color={colors.accent} />
                <Text style={styles.resurveySummaryText}>
                  {resurveyedCount} of {survey?.partCount ?? 0} part{resurveyedCount === 1 ? "" : "s"} resurveyed
                </Text>
              </View>
            ) : null}
            <ClassLegend items={survey?.byClass} classNames={survey?.classNames} showStats />
          </View>

          <Text style={styles.section}>Ship overview</Text>
          <Text style={styles.shipHint}>Tap a colored area to view it, or a gray area to start surveying it.</Text>
          <View style={styles.shipWrap}>
            <ShipZoneMap
              zones={COMMON_SHIP_AREAS.map((area) => {
                const part = survey?.parts.find((p) => p.regionName === area) || null;
                const band = part?.assessment?.severity ?? deriveSeverityBand(part?.meanCorrosionPercent);
                return {
                  area,
                  color: severityColor(band, colors),
                  subtitle: part ? formatPct(part.meanCorrosionPercent) : undefined,
                };
              })}
              onSelectZone={(area) => {
                const part = survey?.parts.find((p) => p.regionName === area);
                const canOpen = part && (part.latestCompleted || part.latest.status === "completed");
                if (canOpen && part) {
                  onOpenVisit(part.latestCompleted?.inferenceId || part.latest.inferenceId);
                } else {
                  onAddPartWithArea(area);
                }
              }}
            />
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
                  key={part.partKey || part.latest.inferenceId || part.regionName}
                  style={styles.row}
                  onPress={() => canOpen && onOpenVisit(openId)}
                >
                  <View style={styles.rowHeader}>
                    <View style={styles.rowTitleWrap}>
                      <Text style={styles.rowTitle}>{partLabel(part)}</Text>
                      {part.observationId ? <Text style={styles.obsId}>{part.observationId}</Text> : null}
                      {part.latestCompleted?.baselineInferenceId ? (
                        <View style={styles.resurveyedTag}>
                          <Ionicons name="repeat" size={11} color={colors.accent} />
                          <Text style={styles.resurveyedTagText}>Resurveyed</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.rowActions}>
                      <Pressable
                        hitSlop={10}
                        onPress={() => {
                          if (part.latestCompleted) {
                            // Always add into the same existing part — a part
                            // has exactly one ongoing entry, never separate visits.
                            onAddPhotosToPart(part.regionName, part.latestCompleted.inferenceId);
                          } else if (isOffline) {
                            // Still fully local (never reached the server) — edit
                            // this exact pending entry instead of starting a new one.
                            onEditQueuedPart(part.regionName, part.latest.inferenceId);
                          } else if (isProcessing) {
                            Alert.alert(
                              "Still inspecting",
                              "Wait for the current inspection to finish before adding more photos."
                            );
                          } else {
                            onAddPartWithArea(part.regionName);
                          }
                        }}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="camera-outline" size={18} color={colors.textMuted} />
                      </Pressable>
                      {part.latestCompleted?.baselineInferenceId || part.latestCompleted?.previousInferenceId ? (
                        <Pressable
                          hitSlop={10}
                          onPress={() => setCompareInferenceId(part.latestCompleted!.inferenceId)}
                          style={styles.deleteBtn}
                        >
                          <Ionicons name="git-compare-outline" size={18} color={colors.textMuted} />
                        </Pressable>
                      ) : null}
                      {part.latestCompleted ? (
                        <Pressable
                          hitSlop={10}
                          onPress={() => setResurveyPart(part)}
                          style={styles.deleteBtn}
                        >
                          <Ionicons name="repeat-outline" size={18} color={colors.textMuted} />
                        </Pressable>
                      ) : null}
                      <Pressable hitSlop={10} onPress={() => deletePart(part)} style={styles.deleteBtn}>
                        <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                      </Pressable>
                    </View>
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
                        : part.latest.status.charAt(0).toUpperCase() + part.latest.status.slice(1)}
                    {part.imageCount ? ` · ${part.imageCount} photo(s)` : ""}
                    {part.pendingAppendCount
                      ? ` · +${part.pendingAppendCount} photo(s) queued to add`
                      : ""}
                  </Text>
                  {part.assessment && assessmentSummary(part.assessment) ? (
                    <Text style={styles.rowAssessment}>Inspector assessment: {assessmentSummary(part.assessment)}</Text>
                  ) : null}
                  {part.latestCompleted?.review ? (
                    <Text
                      style={[
                        styles.rowAssessment,
                        part.latestCompleted.review.verdict === "worse" && { color: colors.danger },
                        part.latestCompleted.review.verdict === "better" && { color: colors.success },
                      ]}
                    >
                      Reviewer:{" "}
                      {part.latestCompleted.review.verdict === "worse"
                        ? "confirmed deterioration"
                        : part.latestCompleted.review.verdict === "better"
                          ? "improved"
                          : "no change"}
                    </Text>
                  ) : null}
                  {part.inspectorName ? <Text style={styles.rowInspector}>Inspected by {part.inspectorName}</Text> : null}
                  {part.notes ? <Text style={styles.rowNotes}>Note: {part.notes}</Text> : null}
                  {canOpen ? <Text style={styles.openHint}>Tap to view this part’s photos</Text> : null}
                  {regionsAwaitingResurvey.has(part.observationId || part.regionName) ? (
                    <Pressable style={styles.resurveyNudge} onPress={() => setResurveyPart(part)}>
                      <Ionicons name="repeat" size={13} color={colors.accent} />
                      <Text style={styles.resurveyNudgeText}>Repair closed — resurvey to confirm</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <ComparisonModal
        session={session}
        currentInferenceId={compareInferenceId}
        onClose={() => setCompareInferenceId(null)}
      />

      <ResurveyStartModal
        visible={!!resurveyPart}
        projectName={projectName}
        area={resurveyPart ? partLabel(resurveyPart) : ""}
        onCancel={() => setResurveyPart(null)}
        onConfirm={(targetSurveyName) => {
          if (!resurveyPart?.latestCompleted) return;
          const area = resurveyPart.regionName;
          const baselineId = resurveyPart.latestCompleted.inferenceId;
          setResurveyPart(null);
          onStartResurvey(area, baselineId, targetSurveyName);
        }}
      />
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
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      rowGap: 10,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    offlineBannerText: { color: colors.textPrimary, fontWeight: "600", flex: 1, marginRight: 10 },
    offlineBannerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    localBtn: {
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7.5,
      minWidth: 100,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    localBtnText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
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
    resurveySummaryRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 },
    resurveySummaryText: { color: colors.accent, fontWeight: "600", fontSize: 12 },
    shipHint: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
    shipWrap: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 20,
      overflow: "hidden",
    },
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
    rowActions: { flexDirection: "row", alignItems: "center", gap: 14 },
    deleteBtn: { padding: 2 },
    rowTitleWrap: { flex: 1, marginRight: 8, gap: 4 },
    obsId: { color: colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
    rowAssessment: { color: colors.accentText, fontSize: 12, fontWeight: "600", marginTop: 4 },
    rowInspector: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowNotes: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
    resurveyedTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    resurveyedTagText: { color: colors.accent, fontWeight: "600", fontSize: 11 },
    partPct: { color: colors.accentText, fontSize: 22, fontWeight: "700", marginTop: 4 },
    partPctPending: { color: colors.textSecondary, fontSize: 16 },
    processingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    processingText: { color: colors.accentText, fontWeight: "700", fontSize: 15 },
    rowMeta: { color: colors.textSecondary, marginTop: 4, fontSize: 13 },
    openHint: { color: colors.textMuted, marginTop: 6, fontSize: 12 },
    resurveyNudge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    resurveyNudgeText: { color: colors.accent, fontWeight: "600", fontSize: 12 },
  });
}
