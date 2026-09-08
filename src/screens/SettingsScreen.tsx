import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { ServerSettingsPanel } from "../components/ServerSettingsPanel";
import { envReady } from "../lib/config";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

const PREFERENCE_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "system", label: "System", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

export function SettingsScreen({ onBack, onSignOut }: { onBack: () => void; onSignOut: () => void }) {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const appVersion = Constants.expoConfig?.version;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Home</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.section}>Appearance</Text>
      <View style={styles.segmentRow}>
        {PREFERENCE_OPTIONS.map((opt) => {
          const active = preference === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setPreference(opt.value)}
            >
              <Ionicons
                name={opt.icon}
                size={16}
                color={active ? "#fff" : colors.textSecondary}
              />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>Server</Text>
      <View style={styles.card}>
        <Text style={styles.cardHint}>
          The web address the app talks to for syncing surveys and downloading models.
        </Text>
        <ServerSettingsPanel onSaved={() => envReady()} />
      </View>

      <Text style={styles.section}>Account</Text>
      <Pressable style={styles.card} onPress={onSignOut}>
        <View style={styles.signOutRow}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </View>
      </Pressable>

      {appVersion ? <Text style={styles.version}>VisionM Inspect v{appVersion}</Text> : null}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
    header: { flexDirection: "row", marginBottom: 8 },
    linkRow: { flexDirection: "row", alignItems: "center" },
    link: { color: colors.accentText, fontWeight: "600" },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700", marginBottom: 20 },
    section: { color: colors.textSecondary, fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
    segmentRow: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 4,
      gap: 4,
      marginBottom: 20,
    },
    segment: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: 9,
    },
    segmentActive: { backgroundColor: colors.accent },
    segmentText: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
    segmentTextActive: { color: "#fff" },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 20,
    },
    cardHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 4 },
    signOutRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
    version: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 },
  });
}
