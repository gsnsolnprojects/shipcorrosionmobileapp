import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { VisionSession } from "../types";

export function HomeScreen({
  session,
  onChooseProject,
  onOpenSettings,
  onSignOut,
}: {
  session: VisionSession;
  onChooseProject: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.root}>
      <NauticalBackground
        icons={[
          { name: "ferry", size: 280, opacity: 0.16, style: { top: -40, right: -60, transform: [{ rotate: "8deg" }] } },
          { name: "anchor", size: 110, opacity: 0.13, style: { bottom: 60, left: -30, transform: [{ rotate: "-12deg" }] } },
        ]}
      />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.anchorBadge}>
            <MaterialCommunityIcons name="anchor" size={22} color={colors.accentText} />
          </View>
          <View>
            <Text style={styles.kicker}>{session.companyName}</Text>
            <Text style={styles.title}>VisionM Inspect</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <ThemeToggle />
          <Pressable onPress={onSignOut} style={styles.signOutBtn} hitSlop={8}>
            <Ionicons name="log-out-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.menu}>
        <Pressable style={styles.menuItem} onPress={onChooseProject}>
          <View style={styles.menuIcon}>
            <MaterialCommunityIcons name="ferry" size={22} color={colors.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuTitle}>Choose project</Text>
            <Text style={styles.menuHint}>Pick a project, then a survey, then start inspecting</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <Pressable style={styles.menuItem} onPress={onOpenSettings}>
          <View style={styles.menuIcon}>
            <Ionicons name="settings-outline" size={20} color={colors.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuTitle}>Settings</Text>
            <Text style={styles.menuHint}>Server address, appearance, and account</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 56 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
    anchorBadge: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: `${colors.accent}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    kicker: { color: colors.accentText, fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
    title: { color: colors.textPrimary, fontSize: 20, fontWeight: "700", marginTop: 2 },
    signOutBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    signOut: { color: colors.textSecondary, fontWeight: "600" },
    menu: { gap: 12 },
    menuItem: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    menuIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: `${colors.accent}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    menuTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
    menuHint: { color: colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },
  });
}
