import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { fetchProjects, renameProject } from "../lib/api";
import { syncQueue } from "../lib/offlineQueue";
import { canManageProjects } from "../lib/session";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { ProjectRow, VisionSession } from "../types";

export function ProjectScreen({
  session,
  onSelect,
  onBack,
}: {
  session: VisionSession;
  onSelect: (projectName: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectRow | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const canRename = canManageProjects(session.role);

  const load = useCallback(async () => {
    if (!session.companyId) {
      setError("No company on this account.");
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setProjects(await fetchProjects(session.companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
    // Best-effort catch-up: this is the first screen the app lands on after
    // reopening, so it's a good moment to flush anything queued offline.
    syncQueue(session).catch(() => {});
  }, [session.companyId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const openRename = (project: ProjectRow) => {
    setRenameTarget(project);
    setRenameDraft(project.name);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      await renameProject(session, renameTarget.id, renameTarget.name, trimmed);
      setRenameTarget(null);
      load();
    } catch (err) {
      Alert.alert(
        "Rename failed",
        err instanceof Error ? err.message : "Try again. If the vessel name changed but its data didn't move, contact support."
      );
    } finally {
      setRenaming(false);
    }
  };

  return (
    <View style={styles.root}>
      <NauticalBackground
        icons={[
          { name: "ferry", size: 260, opacity: 0.14, style: { top: -30, right: -60, transform: [{ rotate: "10deg" }] } },
          { name: "lighthouse-on", size: 100, opacity: 0.12, style: { bottom: 60, left: -20 } },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Home</Text>
        </Pressable>
        <ThemeToggle />
      </View>
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="anchor" size={20} color={colors.accentText} />
        <View>
          <Text style={styles.kicker}>{session.companyName}</Text>
          <Text style={styles.title}>Choose project</Text>
        </View>
      </View>
      {loading && projects.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Ionicons name="refresh" size={14} color={colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="folder-open-outline" size={28} color={colors.textMuted} />
          <Text style={styles.empty}>No projects in this workspace. Create one in the web app.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        >
          {projects.map((p) => (
            <Pressable key={p.id} style={styles.row} onPress={() => onSelect(p.name)}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons name="ferry" size={18} color={colors.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.name}</Text>
                <Text style={styles.rowHint}>Uses the YOLO_SEG model pinned in Workspace Settings</Text>
              </View>
              {canRename ? (
                <Pressable hitSlop={10} onPress={() => openRename(p)} style={styles.editBtn}>
                  <Ionicons name="pencil-outline" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!renameTarget} animationType="fade" transparent onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.modalTitle}>Rename vessel</Text>
            <Text style={styles.modalHint}>
              This renames "{renameTarget?.name}" everywhere — including its past surveys, photos, and actions.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={renameDraft}
              onChangeText={setRenameDraft}
              autoFocus
              placeholder="Vessel name"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setRenameTarget(null)} style={styles.modalCancelBtn} disabled={renaming}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={submitRename} disabled={renaming || !renameDraft.trim()}>
                {renaming ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 56 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    linkRow: { flexDirection: "row", alignItems: "center" },
    link: { color: colors.accentText, fontWeight: "600" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
    kicker: { color: colors.accentText, fontWeight: "700" },
    title: { color: colors.textPrimary, fontSize: 24, fontWeight: "700", marginTop: 2 },
    error: { color: colors.danger, marginTop: 12 },
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
    emptyWrap: { alignItems: "center", marginTop: 48, gap: 10 },
    empty: { color: colors.textSecondary, textAlign: "center", lineHeight: 22 },
    row: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: `${colors.accent}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
    rowHint: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
    editBtn: { padding: 4, marginRight: 4 },
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
    modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", marginBottom: 6 },
    modalHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 14, lineHeight: 17 },
    modalInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
    },
    modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
    modalCancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    modalCancelText: { color: colors.textSecondary, fontWeight: "600", fontSize: 14 },
    modalSaveBtn: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
      minWidth: 64,
      alignItems: "center",
    },
    modalSaveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
