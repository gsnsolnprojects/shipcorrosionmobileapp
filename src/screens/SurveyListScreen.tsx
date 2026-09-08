import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { deleteInferenceJob, getSurvey, listSurveys } from "../lib/api";
import { getQueue, removeFromQueue, syncQueue } from "../lib/offlineQueue";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { SurveySummary, VisionSession } from "../types";

function todayLabel() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPct(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export function SurveyListScreen({
  session,
  projectName,
  onBack,
  onOpenSurvey,
}: {
  session: VisionSession;
  projectName: string;
  onBack: () => void;
  onOpenSurvey: (surveyName: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [surveys, setSurveys] = useState<SurveySummary[]>([]);
  const [pendingBySurvey, setPendingBySurvey] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState(`${projectName} survey ${todayLabel()}`);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);

    let fetched: SurveySummary[] = [];
    let fetchError: string | null = null;
    try {
      fetched = await listSurveys(session, projectName);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : "Could not load surveys";
    }

    const queue = await getQueue();
    const pending: Record<string, number> = {};
    for (const item of queue) {
      if (item.projectName !== projectName) continue;
      pending[item.surveyName] = (pending[item.surveyName] || 0) + 1;
    }
    setPendingBySurvey(pending);

    const known = new Set(fetched.map((s) => s.surveyName));
    const offlineOnly: SurveySummary[] = Object.keys(pending)
      .filter((name) => !known.has(name))
      .map((name) => ({
        surveyName: name,
        partCount: pending[name],
        completedPartCount: 0,
        visitCount: pending[name],
        overallMeanCorrosionPercent: null,
        updatedAt: null,
      }));

    const merged = [...fetched, ...offlineOnly];
    setSurveys(merged);
    setError(fetchError && merged.length === 0 ? fetchError : null);
    setLoading(false);

    // Best-effort: catch up any queued parts now that this screen is open.
    syncQueue(session)
      .then((result) => {
        if (result.uploaded > 0) load();
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [session.companyName, projectName]);

  const filteredSurveys = surveys.filter((s) =>
    s.surveyName.toLowerCase().includes(search.trim().toLowerCase())
  );

  const startSurvey = () => {
    const name = newName.trim();
    if (!name) return;
    onOpenSurvey(name);
  };

  const deleteSurvey = (surveyName: string) => {
    Alert.alert(
      "Delete this survey?",
      `This permanently deletes every part and photo in "${surveyName}". This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const detail = await getSurvey(session, projectName, surveyName);
              for (const part of detail.parts) {
                for (const visit of part.visits) {
                  await deleteInferenceJob(session, visit.inferenceId);
                }
              }
              const queue = await getQueue();
              for (const item of queue) {
                if (item.projectName === projectName && item.surveyName === surveyName) {
                  await removeFromQueue(item.id);
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

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <NauticalBackground
        icons={[
          { name: "sail-boat", size: 240, opacity: 0.13, style: { top: -20, right: -60, transform: [{ rotate: "6deg" }] } },
          { name: "anchor", size: 90, opacity: 0.12, style: { bottom: 100, left: -25, transform: [{ rotate: "10deg" }] } },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Project</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Text style={styles.project}>{projectName}</Text>
          <ThemeToggle />
        </View>
      </View>
      <View style={styles.titleRow}>
        <Ionicons name="compass-outline" size={22} color={colors.accentText} />
        <Text style={styles.title}>Surveys</Text>
      </View>
      <Text style={styles.hint}>
        A survey is one walk around the ship (or one maintenance visit). Inspect parts one by one, then
        compare each part and the whole visit.
      </Text>

      <Text style={styles.label}>New survey name</Text>
      <TextInput
        style={styles.input}
        value={newName}
        onChangeText={setNewName}
        placeholder="MV Pacific Glory — 2026-08-31"
        placeholderTextColor={colors.textMuted}
      />
      <Pressable style={styles.primary} onPress={startSurvey} disabled={!newName.trim()}>
        <Ionicons name="play-forward" size={16} color="#fff" />
        <Text style={styles.primaryText}>Start / open survey</Text>
      </Pressable>

      <Text style={styles.section}>Past surveys</Text>
      {surveys.length > 1 ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search past surveys"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      ) : null}
      {loading && surveys.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : error ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Ionicons name="refresh" size={14} color={colors.textPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : surveys.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="clipboard-outline" size={28} color={colors.textMuted} />
          <Text style={styles.empty}>No surveys yet. Start one above, then add ship parts.</Text>
        </View>
      ) : filteredSurveys.length === 0 ? (
        <Text style={styles.empty}>No surveys match "{search.trim()}".</Text>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        >
          {filteredSurveys.map((s) => {
            const pending = pendingBySurvey[s.surveyName] || 0;
            return (
              <Pressable key={s.surveyName} style={styles.row} onPress={() => onOpenSurvey(s.surveyName)}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>{s.surveyName}</Text>
                  <Pressable hitSlop={10} onPress={() => deleteSurvey(s.surveyName)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.rowMeta}>
                  Whole-ship {formatPct(s.overallMeanCorrosionPercent)} · {s.completedPartCount}/{s.partCount} parts
                </Text>
                {pending > 0 ? (
                  <Text style={styles.pendingTag}>
                    {pending} part{pending === 1 ? "" : "s"} waiting to upload
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    linkRow: { flexDirection: "row", alignItems: "center" },
    link: { color: colors.accentText, fontWeight: "600" },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
    project: { color: colors.textSecondary, fontWeight: "600" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700" },
    hint: { color: colors.textSecondary, marginTop: 8, marginBottom: 16, lineHeight: 20 },
    label: { color: colors.textSecondary, marginBottom: 6 },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    primary: {
      backgroundColor: colors.accent,
      marginTop: 12,
      borderRadius: 10,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    section: { color: colors.textPrimary, fontWeight: "700", marginTop: 24, marginBottom: 10 },
    searchWrap: { position: "relative", justifyContent: "center", marginBottom: 12 },
    searchIcon: { position: "absolute", left: 12, zIndex: 1 },
    search: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingLeft: 36,
      paddingVertical: 10,
    },
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
    emptyWrap: { alignItems: "center", marginTop: 24, gap: 10 },
    empty: { color: colors.textMuted, textAlign: "center", lineHeight: 20 },
    row: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", flex: 1, marginRight: 8 },
    deleteBtn: { padding: 2 },
    rowMeta: { color: colors.textSecondary, marginTop: 4, fontSize: 13 },
    pendingTag: { color: colors.accentText, marginTop: 6, fontSize: 12, fontWeight: "600" },
  });
}
