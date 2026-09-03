import { useEffect, useState } from "react";
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
import { deleteInferenceJob, getSurvey, listSurveys } from "../lib/api";
import { getQueue, removeFromQueue, syncQueue } from "../lib/offlineQueue";
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
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color="#fb923c" />
          <Text style={styles.link}>Project</Text>
        </Pressable>
        <Text style={styles.project}>{projectName}</Text>
      </View>
      <Text style={styles.title}>Surveys</Text>
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
        placeholderTextColor="#64748b"
      />
      <Pressable style={styles.primary} onPress={startSurvey} disabled={!newName.trim()}>
        <Ionicons name="play-forward" size={16} color="#fff" />
        <Text style={styles.primaryText}>Start / open survey</Text>
      </Pressable>

      <Text style={styles.section}>Past surveys</Text>
      {surveys.length > 1 ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#64748b" style={styles.searchIcon} />
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search past surveys"
            placeholderTextColor="#64748b"
          />
        </View>
      ) : null}
      {loading && surveys.length === 0 ? (
        <ActivityIndicator color="#f97316" style={{ marginTop: 20 }} />
      ) : error ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Ionicons name="refresh" size={14} color="#e2e8f0" />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : surveys.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="clipboard-outline" size={28} color="#475569" />
          <Text style={styles.empty}>No surveys yet. Start one above, then add ship parts.</Text>
        </View>
      ) : filteredSurveys.length === 0 ? (
        <Text style={styles.empty}>No surveys match "{search.trim()}".</Text>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#f97316" />}
        >
          {filteredSurveys.map((s) => {
            const pending = pendingBySurvey[s.surveyName] || 0;
            return (
              <Pressable key={s.surveyName} style={styles.row} onPress={() => onOpenSurvey(s.surveyName)}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>{s.surveyName}</Text>
                  <Pressable hitSlop={10} onPress={() => deleteSurvey(s.surveyName)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color="#64748b" />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 52 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  linkRow: { flexDirection: "row", alignItems: "center" },
  link: { color: "#fb923c", fontWeight: "600" },
  project: { color: "#94a3b8", fontWeight: "600" },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700" },
  hint: { color: "#94a3b8", marginTop: 8, marginBottom: 16, lineHeight: 20 },
  label: { color: "#cbd5e1", marginBottom: 6 },
  input: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  primary: {
    backgroundColor: "#ea580c",
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  section: { color: "#e2e8f0", fontWeight: "700", marginTop: 24, marginBottom: 10 },
  searchWrap: { position: "relative", justifyContent: "center", marginBottom: 12 },
  searchIcon: { position: "absolute", left: 12, zIndex: 1 },
  search: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingLeft: 36,
    paddingVertical: 10,
  },
  error: { color: "#fca5a5" },
  retry: {
    marginTop: 12,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: "#e2e8f0", fontWeight: "600" },
  emptyWrap: { alignItems: "center", marginTop: 24, gap: 10 },
  empty: { color: "#64748b", textAlign: "center", lineHeight: 20 },
  row: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  rowTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "600", flex: 1, marginRight: 8 },
  deleteBtn: { padding: 2 },
  rowMeta: { color: "#94a3b8", marginTop: 4, fontSize: 13 },
  pendingTag: { color: "#fb923c", marginTop: 6, fontSize: 12, fontWeight: "600" },
});
