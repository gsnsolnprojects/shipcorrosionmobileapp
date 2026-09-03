import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { getInferenceStatus } from "../lib/api";
import type { VisionSession } from "../types";

export function ProgressScreen({
  session,
  inferenceId,
  regionName,
  onCompleted,
  onFailed,
  onCancelView,
}: {
  session: VisionSession;
  inferenceId: string;
  regionName: string;
  onCompleted: () => void;
  onFailed: (message: string) => void;
  onCancelView: () => void;
}) {
  const [percent, setPercent] = useState(0);
  const [status, setStatus] = useState("queued");
  const barProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barProgress, {
      toValue: Math.max(0, Math.min(100, percent)),
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [percent, barProgress]);

  useEffect(() => {
    let stopped = false;
    let finished = false;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped || finished) return;
      try {
        const data = await getInferenceStatus(session, inferenceId);
        if (stopped || finished) return;
        misses = 0;
        setStatus(data.status);
        setPercent(data.progress?.progressPercent ?? 0);
        if (data.status === "completed") {
          finished = true;
          onCompleted();
          return;
        }
        if (data.status === "failed" || data.status === "cancelled") {
          finished = true;
          onFailed(data.error?.message || `Job ${data.status}`);
          return;
        }
      } catch (err) {
        misses += 1;
        if (!stopped && !finished && misses >= 5) {
          finished = true;
          onFailed(err instanceof Error ? err.message : "Status check failed");
          return;
        }
      }
      if (!stopped && !finished) {
        timer = setTimeout(tick, 800);
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [inferenceId, session, onCompleted, onFailed]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Inspecting</Text>
      <Text style={styles.sub}>{regionName}</Text>
      <Text style={styles.status}>{status}</Text>
      <ActivityIndicator color="#f97316" size="large" style={{ marginTop: 24, marginBottom: 20 }} />
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: barProgress.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
      <Text style={styles.percent}>{Math.round(percent)}%</Text>
      <Pressable onPress={onCancelView} style={{ marginTop: 32 }}>
        <Text style={styles.link}>Leave (job keeps running)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700" },
  sub: { color: "#fb923c", marginTop: 8, fontWeight: "600" },
  status: { color: "#94a3b8", marginTop: 12, textTransform: "capitalize" },
  barTrack: {
    width: 240,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#1e293b",
    overflow: "hidden",
    marginBottom: 14,
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#ea580c",
  },
  percent: { color: "#f8fafc", fontSize: 32, fontWeight: "700" },
  link: { color: "#64748b" },
});
