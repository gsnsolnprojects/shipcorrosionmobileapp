import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ServerSettingsPanel } from "../components/ServerSettingsPanel";
import { fetchProjects } from "../lib/api";
import { syncQueue } from "../lib/offlineQueue";
import type { ProjectRow, VisionSession } from "../types";

export function ProjectScreen({
  session,
  onSelect,
  onSignOut,
}: {
  session: VisionSession;
  onSelect: (projectName: string) => void;
  onSignOut: () => void;
}) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{session.companyName}</Text>
          <Text style={styles.title}>Choose project</Text>
        </View>
        <Pressable onPress={onSignOut} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={16} color="#94a3b8" />
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      {loading && projects.length === 0 ? (
        <ActivityIndicator color="#f97316" style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={load}>
            <Ionicons name="refresh" size={14} color="#e2e8f0" />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="folder-open-outline" size={28} color="#475569" />
          <Text style={styles.empty}>No projects in this workspace. Create one in the web app.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#f97316" />}
        >
          {projects.map((p) => (
            <Pressable key={p.id} style={styles.row} onPress={() => onSelect(p.name)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{p.name}</Text>
                <Text style={styles.rowHint}>Uses the YOLO_SEG model pinned in Workspace Settings</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#475569" />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <ServerSettingsPanel onSaved={load} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 56 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  kicker: { color: "#fb923c", fontWeight: "700" },
  title: { color: "#f8fafc", fontSize: 24, fontWeight: "700", marginTop: 4 },
  signOutBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  signOut: { color: "#94a3b8", fontWeight: "600" },
  error: { color: "#fca5a5", marginTop: 12 },
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
  emptyWrap: { alignItems: "center", marginTop: 48, gap: 10 },
  empty: { color: "#94a3b8", textAlign: "center", lineHeight: 22 },
  row: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
    flexDirection: "row",
    alignItems: "center",
  },
  rowTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "600" },
  rowHint: { color: "#64748b", marginTop: 4, fontSize: 12 },
});
