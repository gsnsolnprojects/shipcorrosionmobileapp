import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

function todayLabel() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Confirms/renames the NEW survey a resurvey will be filed under — shown
 * when starting a resurvey from a past survey's part row, since that part
 * belongs to an already-closed survey and the resurvey needs a new one.
 */
export function ResurveyStartModal({
  visible,
  projectName,
  area,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  projectName: string;
  area: string;
  onCancel: () => void;
  onConfirm: (surveyName: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState(`${projectName} survey ${todayLabel()}`);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Ionicons name="repeat" size={20} color={colors.accentText} />
            <Text style={styles.title}>Resurvey "{area}"</Text>
          </View>
          <Text style={styles.hint}>
            This re-shoots this part's old photos as a new survey entry. Name the new survey, or keep the default.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder="Survey name"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, name.trim().length === 0 && styles.disabled]}
              disabled={name.trim().length === 0}
              onPress={() => onConfirm(name.trim())}
            >
              <Text style={styles.confirmText}>Start resurvey</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", flexShrink: 1 },
    hint: { color: colors.textSecondary, marginTop: 10, marginBottom: 14, lineHeight: 19 },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
    cancel: { paddingVertical: 10, paddingHorizontal: 14 },
    cancelText: { color: colors.textSecondary, fontWeight: "600" },
    confirm: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
    disabled: { opacity: 0.45 },
    confirmText: { color: "#fff", fontWeight: "700" },
  });
}
