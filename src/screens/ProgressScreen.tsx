import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { getInferenceStatus } from "../lib/api";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [percent, setPercent] = useState(0);
  const [status, setStatus] = useState("queued");
  const barProgress = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barProgress, {
      toValue: Math.max(0, Math.min(100, percent)),
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [percent, barProgress]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

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
      <View style={styles.toggleRow}>
        <ThemeToggle />
      </View>
      <Animated.View
        style={{
          transform: [
            { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
          ],
        }}
      >
        <MaterialCommunityIcons name="sail-boat" size={40} color={colors.accentText} />
      </Animated.View>
      <Text style={styles.title}>Inspecting</Text>
      <Text style={styles.sub}>{regionName}</Text>
      <Text style={styles.status}>{status}</Text>
      <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 24, marginBottom: 20 }} />
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24 },
    toggleRow: { position: "absolute", top: 52, right: 24 },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700", marginTop: 14 },
    sub: { color: colors.accentText, marginTop: 8, fontWeight: "600" },
    status: { color: colors.textSecondary, marginTop: 12, textTransform: "capitalize" },
    barTrack: {
      width: 240,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      overflow: "hidden",
      marginBottom: 14,
    },
    barFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: colors.accent,
    },
    percent: { color: colors.textPrimary, fontSize: 32, fontWeight: "700" },
    link: { color: colors.textMuted },
  });
}
