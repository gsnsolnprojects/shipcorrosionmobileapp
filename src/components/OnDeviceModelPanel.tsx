import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  downloadPinnedModel,
  getCustomModelMeta,
  importModelFile,
  resetToDefaultModel,
  type CustomModelMeta,
  type TfliteVariant,
} from "../lib/modelManager";
import { invalidateModelCache } from "../lib/onDeviceInference";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { VisionSession } from "../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Lets a crew member swap the on-device corrosion model without an app
 * rebuild — download whatever's pinned for this project in Workspace
 * Settings, import a .tflite already on the phone, or reset to the model
 * bundled in the app. Only swaps between models with the same
 * architecture/classes as the bundled one (same YOLOv8-seg export) — this
 * is for picking up a retrained version, not an unrelated model.
 */
export function OnDeviceModelPanel({ session, projectName }: { session: VisionSession; projectName: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<CustomModelMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshMeta = async () => {
    setLoadingMeta(true);
    try {
      setMeta(await getCustomModelMeta());
    } finally {
      setLoadingMeta(false);
    }
  };

  const openPanel = () => {
    setOpen(true);
    refreshMeta();
  };

  const download = async (variant: TfliteVariant) => {
    setBusy(`download-${variant}`);
    try {
      const next = await downloadPinnedModel(session, projectName, variant);
      invalidateModelCache();
      setMeta(next);
      Alert.alert("Model updated", `Now using ${next.label} for on-device inspection.`);
    } catch (err) {
      Alert.alert("Download failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const importFile = async () => {
    setBusy("import");
    try {
      const next = await importModelFile();
      invalidateModelCache();
      setMeta(next);
      Alert.alert("Model updated", `Now using ${next.label} for on-device inspection.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Try again.";
      if (!/cancel/i.test(message)) {
        Alert.alert("Import failed", message);
      }
    } finally {
      setBusy(null);
    }
  };

  const resetModel = async () => {
    setBusy("reset");
    try {
      await resetToDefaultModel();
      invalidateModelCache();
      setMeta(null);
      Alert.alert("Model reset", "Now using the model bundled with the app.");
    } catch (err) {
      Alert.alert("Reset failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Pressable onPress={openPanel} hitSlop={8}>
        <Ionicons name="hardware-chip-outline" size={20} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Ionicons name="hardware-chip-outline" size={20} color={colors.accentText} />
              <Text style={styles.title}>On-device model</Text>
            </View>

            {loadingMeta ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
            ) : (
              <View style={styles.currentBox}>
                <Text style={styles.currentLabel}>Currently active</Text>
                {meta ? (
                  <>
                    <Text style={styles.currentValue}>
                      {meta.source === "server" ? "Downloaded" : "Imported"}: {meta.label}
                    </Text>
                    <Text style={styles.currentMeta}>
                      {formatFileSize(meta.fileSize)} · {formatDate(meta.downloadedAt)}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.currentValue}>Bundled default model</Text>
                )}
              </View>
            )}

            <ScrollView style={{ maxHeight: 340 }}>
              <Text style={styles.section}>Download pinned model</Text>
              <Text style={styles.hint}>
                Fetches whichever YOLO_SEG model is pinned for "{projectName}" in Workspace Settings on the
                web app. First download for a model can take a few minutes if it hasn't been converted yet.
              </Text>
              <View style={styles.rowBtns}>
                <Pressable
                  style={[styles.secondary, !!busy && styles.disabled]}
                  onPress={() => download("float16")}
                  disabled={!!busy}
                >
                  {busy === "download-float16" ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.secondaryText}>float16 (smaller)</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.secondary, !!busy && styles.disabled]}
                  onPress={() => download("float32")}
                  disabled={!!busy}
                >
                  {busy === "download-float32" ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.secondaryText}>float32 (precise)</Text>
                  )}
                </Pressable>
              </View>

              <Text style={styles.section}>Import from this device</Text>
              <Text style={styles.hint}>Pick a .tflite file already saved on the phone.</Text>
              <Pressable
                style={[styles.secondary, !!busy && styles.disabled]}
                onPress={importFile}
                disabled={!!busy}
              >
                {busy === "import" ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Text style={styles.secondaryText}>Choose .tflite file</Text>
                )}
              </Pressable>

              {meta ? (
                <>
                  <Text style={styles.section}>Reset</Text>
                  <Pressable
                    style={[styles.secondary, !!busy && styles.disabled]}
                    onPress={resetModel}
                    disabled={!!busy}
                  >
                    {busy === "reset" ? (
                      <ActivityIndicator color={colors.textPrimary} size="small" />
                    ) : (
                      <Text style={styles.secondaryText}>Use bundled default model</Text>
                    )}
                  </Pressable>
                </>
              ) : null}
            </ScrollView>

            <Pressable onPress={() => setOpen(false)} style={styles.closeBtn} disabled={!!busy}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(15,23,42,0.85)",
      justifyContent: "center",
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
    currentBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    currentLabel: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
    currentValue: { color: colors.textPrimary, fontWeight: "700", marginTop: 4 },
    currentMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    section: { color: colors.textPrimary, fontWeight: "700", marginTop: 14, marginBottom: 4, fontSize: 13 },
    hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 10, lineHeight: 16 },
    rowBtns: { flexDirection: "row", gap: 10 },
    secondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
    disabled: { opacity: 0.5 },
    closeBtn: { marginTop: 16, alignItems: "center", paddingVertical: 8 },
    closeText: { color: colors.textSecondary, fontWeight: "600" },
  });
}
