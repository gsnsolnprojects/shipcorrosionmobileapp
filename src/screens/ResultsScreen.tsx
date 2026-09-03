import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AuthImage } from "../components/AuthImage";
import { ClassLegend } from "../components/ClassLegend";
import { ImageViewerModal } from "../components/ImageViewerModal";
import { PIXEL_DISCLAIMER } from "../lib/config";
import type { InspectResults, ResultImage, VisionSession } from "../types";

function formatPct(n: number | undefined | null): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function imagePercents(results: InspectResults): number[] {
  return results.images
    .map((img) => img.corrosionPercentTotal)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

export function ResultsScreen({
  session,
  results,
  onNewInspect,
  onBackToSurvey,
}: {
  session: VisionSession;
  results: InspectResults;
  onNewInspect: () => void;
  onBackToSurvey?: () => void;
}) {
  const percents = imagePercents(results);
  const totalCorrosion =
    typeof results.batch?.meanCorrosionPercent === "number"
      ? results.batch.meanCorrosionPercent
      : percents.length
        ? percents.reduce((sum, n) => sum + n, 0) / percents.length
        : null;
  const batchClasses = results.batch?.byClass || [];
  const classNames = results.classNames || results.batch?.classNames;
  const totalInstances = results.images.reduce((sum, img) => {
    const fromClass = (img.byClass || []).reduce((s, row) => s + (row.count || 0), 0);
    return sum + (img.instanceCount ?? fromClass);
  }, 0);

  const [viewer, setViewer] = useState<{ uri: string; image: ResultImage } | null>(null);

  const viewerSubtitle = viewer
    ? `Total ${formatPct(viewer.image.corrosionPercentTotal)} of this photo’s pixels`
    : undefined;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {onBackToSurvey ? (
          <Pressable onPress={onBackToSurvey} style={styles.linkRow}>
            <Ionicons name="chevron-back" size={18} color="#fb923c" />
            <Text style={styles.link}>Survey</Text>
          </Pressable>
        ) : (
          <Text style={styles.title}>Results</Text>
        )}
        <Pressable onPress={onNewInspect} style={styles.linkRow}>
          <Text style={styles.link}>Next part</Text>
          <Ionicons name="chevron-forward" size={18} color="#fb923c" />
        </Pressable>
      </View>
      {onBackToSurvey ? <Text style={styles.title}>This part</Text> : null}
      {results.surveyName ? <Text style={styles.region}>{results.surveyName}</Text> : null}
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {results.regionName ? <Text style={styles.region}>{results.regionName}</Text> : null}
        <Text style={styles.disclaimer}>{PIXEL_DISCLAIMER}</Text>

        <View style={styles.batch}>
          <Text style={styles.batchLabel}>This part</Text>
          <Text style={styles.batchValue}>{formatPct(totalCorrosion)}</Text>
          <Text style={styles.batchMeta}>
            Average across {results.batch?.imageCount ?? results.images.length} uploaded photo(s)
            {totalInstances ? ` · ${totalInstances} instances` : ""}
          </Text>
          {percents.length > 1 ? (
            <Text style={styles.batchMeta}>
              Per photo: {percents.map((n) => `${n.toFixed(1)}%`).join(" · ")}
            </Text>
          ) : null}
          <ClassLegend items={batchClasses} classNames={classNames} showStats />
        </View>

        {results.images.map((img) => (
          <View key={img.filename} style={styles.card}>
            <AuthImage
              url={img.url}
              session={session}
              height={260}
              resizeMode="contain"
              onPress={(dataUrl) => setViewer({ uri: dataUrl, image: img })}
            />
            <Text style={styles.file}>{img.filename}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 52 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700" },
  linkRow: { flexDirection: "row", alignItems: "center" },
  link: { color: "#fb923c", fontWeight: "600" },
  region: { color: "#fb923c", fontWeight: "700", fontSize: 16, marginBottom: 6 },
  disclaimer: { color: "#94a3b8", marginBottom: 16, lineHeight: 20 },
  batch: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  batchLabel: { color: "#94a3b8", fontSize: 12 },
  batchValue: { color: "#f8fafc", fontSize: 32, fontWeight: "700", marginTop: 4 },
  batchMeta: { color: "#64748b", marginTop: 4, marginBottom: 4 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  file: { color: "#94a3b8", fontSize: 12, marginTop: 8 },
  total: { color: "#f8fafc", fontSize: 18, fontWeight: "700", marginTop: 4, marginBottom: 4 },
});
