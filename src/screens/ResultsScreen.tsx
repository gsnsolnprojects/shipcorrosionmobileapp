import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { AuthImage } from "../components/AuthImage";
import { ClassLegend } from "../components/ClassLegend";
import { ImageViewerModal } from "../components/ImageViewerModal";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { confirmInferencePart, deleteInferenceImage, saveAssessment } from "../lib/api";
import { DAMAGE_TAG_OPTIONS, SEVERITY_OPTIONS, severityLabel } from "../lib/assessment";
import { deriveSeverityBand, severityColor } from "../lib/severity";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { Assessment, CorrosionByClass, DamageTag, InspectResults, ResultImage, Severity, VisionSession } from "../types";

function formatPct(n: number | undefined | null): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function imagePercents(images: ResultImage[]): number[] {
  return images
    .map((img) => img.corrosionPercentTotal)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** Recomputes the batch aggregate client-side for on-device results, which never touch the server. */
function recomputeLocalBatch(images: ResultImage[], classNames: string[]): InspectResults["batch"] {
  const percents = imagePercents(images);
  const meanCorrosionPercent = percents.length
    ? percents.reduce((sum, n) => sum + n, 0) / percents.length
    : undefined;

  const byClass: CorrosionByClass[] = classNames.map((name, classId) => {
    const rows = images.map((img) => (img.byClass || []).find((r) => r.class === name)).filter(Boolean) as CorrosionByClass[];
    const percentSum = rows.reduce((sum, r) => sum + (r.percent ?? r.meanPercent ?? 0), 0);
    const count = rows.reduce((sum, r) => sum + (r.count || 0), 0);
    return { class: name, classId, percent: rows.length ? percentSum / rows.length : 0, count };
  });

  return { imageCount: images.length, meanCorrosionPercent, byClass, classNames };
}

export function ResultsScreen({
  session,
  results,
  onNewInspect,
  onAddMorePhotos,
  onBackToSurvey,
  onConfirmOnDeviceUpload,
}: {
  session: VisionSession;
  results: InspectResults;
  onNewInspect: () => void;
  onAddMorePhotos?: () => void;
  onBackToSurvey?: () => void;
  /** For on-device previews: uploads the same photos for real server inference, making this a permanent survey part. */
  onConfirmOnDeviceUpload?: (assessment: Assessment) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const isOnDevice = results.inferenceId.startsWith("ondevice_");
  const [images, setImages] = useState<ResultImage[]>(results.images);
  const [batch, setBatch] = useState<InspectResults["batch"]>(results.batch);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(!!results.confirmed);
  const [confirming, setConfirming] = useState(false);

  // The inspector's own call on severity + damage types. The AI's corrosion-%
  // band is pre-selected as a suggestion, so confirming as-is is one tap.
  const aiBand = deriveSeverityBand(results.batch?.meanCorrosionPercent);
  const [severity, setSeverity] = useState<Severity | null>(results.assessment?.severity ?? aiBand);
  const [damageTags, setDamageTags] = useState<DamageTag[]>(results.assessment?.damageTags ?? []);
  const [savedAssessment, setSavedAssessment] = useState<Assessment | null>(results.assessment ?? null);
  const [savingAssessment, setSavingAssessment] = useState(false);

  const currentAssessment = (): Assessment => ({ severity, damageTags });
  const sameTags = (a: DamageTag[], b: DamageTag[]) => [...a].sort().join() === [...b].sort().join();
  const assessmentDirty =
    confirmed && (severity !== (savedAssessment?.severity ?? null) || !sameTags(damageTags, savedAssessment?.damageTags ?? []));
  const toggleTag = (tag: DamageTag) =>
    setDamageTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const saveChanges = async () => {
    setSavingAssessment(true);
    try {
      const saved = await saveAssessment(session, results.inferenceId, currentAssessment());
      setSavedAssessment(saved);
    } catch (err) {
      Alert.alert("Couldn’t save assessment", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSavingAssessment(false);
    }
  };

  const confirmPart = async () => {
    setConfirming(true);
    try {
      if (isOnDevice) {
        if (onConfirmOnDeviceUpload) await onConfirmOnDeviceUpload(currentAssessment());
        // Success swaps in the real, completed job under a new inferenceId —
        // App.tsx keys this screen by inferenceId, so it remounts fresh
        // rather than reusing this instance's stale local state.
        return;
      }
      await confirmInferencePart(session, results.inferenceId, currentAssessment());
      setSavedAssessment(currentAssessment());
      setConfirmed(true);
      setConfirming(false);
    } catch (err) {
      Alert.alert(
        isOnDevice ? "Upload failed" : "Couldn’t confirm",
        err instanceof Error ? err.message : "Try again."
      );
      setConfirming(false);
    }
  };

  const locked = !confirmed;
  const requireConfirm = (action: () => void) => () => {
    if (locked) {
      Alert.alert("Confirm this part first", "Tap the confirm button below before leaving this screen.");
      return;
    }
    action();
  };

  const percents = imagePercents(images);
  const totalCorrosion =
    typeof batch?.meanCorrosionPercent === "number"
      ? batch.meanCorrosionPercent
      : percents.length
        ? percents.reduce((sum, n) => sum + n, 0) / percents.length
        : null;
  const batchClasses = batch?.byClass || [];
  const classNames = results.classNames || batch?.classNames || [];
  const totalInstances = images.reduce((sum, img) => {
    const fromClass = (img.byClass || []).reduce((s, row) => s + (row.count || 0), 0);
    return sum + (img.instanceCount ?? fromClass);
  }, 0);

  const [viewer, setViewer] = useState<{ uri: string; image: ResultImage } | null>(null);

  const viewerSubtitle = viewer
    ? `Total ${formatPct(viewer.image.corrosionPercentTotal)} of this photo’s pixels`
    : undefined;

  const deletePhoto = (img: ResultImage) => {
    if (images.length <= 1) {
      Alert.alert(
        "Can’t delete the last photo",
        "A part must keep at least one photo. Delete the whole part from the survey screen instead."
      );
      return;
    }
    Alert.alert("Delete this photo?", `Remove "${img.filename}" from this part's results?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingFilename(img.filename);
          try {
            if (isOnDevice) {
              const nextImages = images.filter((i) => i.filename !== img.filename);
              setImages(nextImages);
              setBatch(recomputeLocalBatch(nextImages, classNames));
            } else {
              const result = await deleteInferenceImage(session, results.inferenceId, img.filename);
              setImages((prev) => prev.filter((i) => i.filename !== img.filename));
              if (result.batch) setBatch(result.batch);
            }
          } catch (err) {
            Alert.alert("Delete failed", err instanceof Error ? err.message : "Try again.");
          } finally {
            setDeletingFilename(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <NauticalBackground
        icons={[
          { name: "lifebuoy", size: 200, opacity: 0.1, style: { bottom: -40, right: -40, transform: [{ rotate: "6deg" }] } },
          { name: "waves", size: 120, opacity: 0.12, style: { top: 110, left: -30 } },
        ]}
      />
      <View style={styles.header}>
        {onBackToSurvey ? (
          <Pressable onPress={requireConfirm(onBackToSurvey)} style={[styles.linkRow, locked && styles.linkRowLocked]}>
            <Ionicons name="chevron-back" size={18} color={locked ? colors.textMuted : colors.accentText} />
            <Text style={[styles.link, locked && styles.linkLocked]}>Survey</Text>
          </Pressable>
        ) : (
          <Text style={styles.title}>Results</Text>
        )}
        <View style={styles.headerRight}>
          <ThemeToggle />
          <Pressable onPress={requireConfirm(onNewInspect)} style={[styles.linkRow, locked && styles.linkRowLocked]}>
            <Text style={[styles.link, locked && styles.linkLocked]}>Next part</Text>
            <Ionicons name="chevron-forward" size={18} color={locked ? colors.textMuted : colors.accentText} />
          </Pressable>
        </View>
      </View>
      {onBackToSurvey ? (
        <View style={styles.titleRow}>
          <MaterialCommunityIcons name="lifebuoy" size={20} color={colors.accentText} />
          <Text style={styles.title}>This part</Text>
        </View>
      ) : null}
      {results.surveyName ? <Text style={styles.region}>{results.surveyName}</Text> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {results.regionName ? <Text style={styles.region}>{results.regionName}</Text> : null}

        <View style={styles.batch}>
          <Text style={styles.batchLabel}>This part</Text>
          <Text style={styles.batchValue}>{formatPct(totalCorrosion)}</Text>
          <Text style={styles.batchMeta}>
            Average across {batch?.imageCount ?? images.length} photo(s)
            {totalInstances ? ` · ${totalInstances} instances` : ""}
          </Text>
          {percents.length > 1 ? (
            <Text style={styles.batchMeta}>
              Per photo: {percents.map((n) => `${n.toFixed(1)}%`).join(" · ")}
            </Text>
          ) : null}
          <ClassLegend items={batchClasses} classNames={classNames} showStats />
        </View>

        <View style={styles.assessCard}>
          <View style={styles.assessHeader}>
            <Ionicons name="clipboard-outline" size={18} color={colors.accentText} />
            <Text style={styles.assessTitle}>Your assessment</Text>
          </View>
          <Text style={styles.assessHint}>
            {aiBand
              ? `The AI suggests ${severityLabel(aiBand)} (${formatPct(results.batch?.meanCorrosionPercent)}). Confirm it, or change it if you see otherwise.`
              : "Pick the severity you see on this part."}
          </Text>

          <Text style={styles.assessLabel}>Severity</Text>
          <View style={styles.chipRow}>
            {SEVERITY_OPTIONS.map((opt) => {
              const active = severity === opt.value;
              const color = severityColor(opt.value, colors);
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSeverity(opt.value)}
                  style={[styles.assessChip, { borderColor: color }, active && { backgroundColor: color }]}
                >
                  <Text style={[styles.assessChipText, { color: active ? "#fff" : colors.textPrimary }]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.assessLabel}>Damage you can see (optional)</Text>
          <View style={styles.chipRow}>
            {DAMAGE_TAG_OPTIONS.map((opt) => {
              const active = damageTags.includes(opt.value);
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => toggleTag(opt.value)}
                  style={[styles.assessChip, { borderColor: colors.accent }, active && { backgroundColor: colors.accent }]}
                >
                  <Text style={[styles.assessChipText, { color: active ? "#fff" : colors.textPrimary }]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {assessmentDirty ? (
            <Pressable style={styles.assessSave} onPress={saveChanges} disabled={savingAssessment}>
              {savingAssessment ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>Save assessment</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        {confirmed ? (
          <View style={styles.confirmedBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.confirmedText}>Confirmed — this part is added to the survey</Text>
          </View>
        ) : (
          <>
            <Text style={styles.confirmHint}>
              {isOnDevice
                ? "This is an on-device preview, not yet saved. Confirm to upload these results and add this part to the survey — Survey and Next part are locked until you do."
                : "Confirm to leave this screen — Survey and Next part are locked until you do."}
            </Text>
            <Pressable style={styles.confirmBtn} onPress={confirmPart} disabled={confirming}>
              {confirming ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons
                    name={isOnDevice ? "cloud-upload-outline" : "checkmark-circle-outline"}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.confirmBtnText}>
                    {isOnDevice ? "Confirm assessment & upload" : "Confirm assessment"}
                  </Text>
                </>
              )}
            </Pressable>
          </>
        )}

        {onAddMorePhotos ? (
          <Pressable style={styles.addMoreBtn} onPress={onAddMorePhotos}>
            <Ionicons name="camera-outline" size={18} color={colors.accentText} />
            <Text style={styles.addMoreText}>Add more photos to this part</Text>
          </Pressable>
        ) : null}

        {images.map((img) => (
          <View key={img.filename} style={styles.card}>
            <AuthImage
              url={img.url}
              session={session}
              height={260}
              resizeMode="contain"
              onPress={(dataUrl) => setViewer({ uri: dataUrl, image: img })}
            />
            <View style={styles.cardHeaderRow}>
              <Text style={styles.file} numberOfLines={1}>
                {img.filename}
              </Text>
              <Pressable
                hitSlop={10}
                style={styles.deleteBtn}
                onPress={() => deletePhoto(img)}
                disabled={deletingFilename === img.filename}
              >
                {deletingFilename === img.filename ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                )}
              </Pressable>
            </View>
            <Text style={styles.total}>This photo {formatPct(img.corrosionPercentTotal)}</Text>
            <ClassLegend items={img.byClass} classNames={classNames} title="This photo" showStats />
          </View>
        ))}
      </ScrollView>

      <ImageViewerModal
        visible={!!viewer}
        uri={viewer?.uri ?? null}
        title={viewer?.image.filename}
        subtitle={viewerSubtitle}
        legendItems={viewer?.image.byClass}
        classNames={classNames}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    linkRow: { flexDirection: "row", alignItems: "center" },
    linkRowLocked: { opacity: 0.45 },
    link: { color: colors.accentText, fontWeight: "600" },
    linkLocked: { color: colors.textMuted },
    region: { color: colors.accentText, fontWeight: "700", fontSize: 16, marginBottom: 6 },
    batch: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    batchLabel: { color: colors.textSecondary, fontSize: 12 },
    batchValue: { color: colors.textPrimary, fontSize: 32, fontWeight: "700", marginTop: 4 },
    batchMeta: { color: colors.textMuted, marginTop: 4, marginBottom: 4 },
    assessCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 12,
      padding: 14,
      marginBottom: 14,
    },
    assessHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    assessTitle: { color: colors.textPrimary, fontWeight: "700", fontSize: 15 },
    assessHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
    assessLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    assessChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    assessChipText: { fontSize: 13, fontWeight: "700" },
    assessSave: {
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: "center",
      marginTop: 14,
    },
    confirmHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
    confirmBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 13,
      marginBottom: 12,
    },
    confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    confirmedBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.success,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 12,
    },
    confirmedText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13, flex: 1 },
    addMoreBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 12,
      marginBottom: 16,
    },
    addMoreText: { color: colors.accentText, fontWeight: "700", fontSize: 14 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
    deleteBtn: { padding: 2 },
    file: { color: colors.textSecondary, fontSize: 12, flex: 1, marginRight: 8 },
    total: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 4, marginBottom: 4 },
  });
}
