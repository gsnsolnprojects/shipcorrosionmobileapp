import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { AuthImage } from "../components/AuthImage";
import { ClassLegend } from "../components/ClassLegend";
import { ImageViewerModal } from "../components/ImageViewerModal";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { deleteInferenceImage } from "../lib/api";
import { PIXEL_DISCLAIMER } from "../lib/config";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { CorrosionByClass, InspectResults, ResultImage, VisionSession } from "../types";

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
}: {
  session: VisionSession;
  results: InspectResults;
  onNewInspect: () => void;
  onAddMorePhotos?: () => void;
  onBackToSurvey?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const isOnDevice = results.inferenceId.startsWith("ondevice_");
  const [images, setImages] = useState<ResultImage[]>(results.images);
  const [batch, setBatch] = useState<InspectResults["batch"]>(results.batch);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

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
          <Pressable onPress={onBackToSurvey} style={styles.linkRow}>
            <Ionicons name="chevron-back" size={18} color={colors.accentText} />
            <Text style={styles.link}>Survey</Text>
          </Pressable>
        ) : (
          <Text style={styles.title}>Results</Text>
        )}
        <View style={styles.headerRight}>
          <ThemeToggle />
          <Pressable onPress={onNewInspect} style={styles.linkRow}>
            <Text style={styles.link}>Next part</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.accentText} />
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
        <Text style={styles.disclaimer}>{PIXEL_DISCLAIMER}</Text>

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
    link: { color: colors.accentText, fontWeight: "600" },
    region: { color: colors.accentText, fontWeight: "700", fontSize: 16, marginBottom: 6 },
    disclaimer: { color: colors.textSecondary, marginBottom: 16, lineHeight: 20 },
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
