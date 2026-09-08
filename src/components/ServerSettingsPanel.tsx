import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getApiBaseUrl, setApiBaseUrlOverride } from "../lib/config";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

/**
 * Lets the crew member point the app at a new backend address (new WiFi, new
 * tunnel URL, laptop restarted, etc.) from the phone itself, with no rebuild.
 *
 * Renders as a modal dialog rather than inline content — that keeps its
 * keyboard handling self-contained instead of depending on whatever
 * scroll/layout setup the screen it's opened from happens to have.
 */
export function ServerSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getApiBaseUrl());

  const openPanel = () => {
    setUrl(getApiBaseUrl());
    setOpen(true);
  };

  const save = async () => {
    await setApiBaseUrlOverride(url);
    setOpen(false);
    onSaved?.();
  };

  return (
    <>
      <Pressable onPress={openPanel} style={styles.linkWrap}>
        <Text style={styles.link}>Server settings</Text>
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.card}>
            <Text style={styles.label}>Server address</Text>
            <Text style={styles.hint}>The web address the app talks to. Ends in /api.</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="https://your-address/api"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.row}>
              <Pressable onPress={() => setOpen(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    linkWrap: { marginTop: 16, alignItems: "center" },
    link: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
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
    label: { color: colors.textPrimary, marginBottom: 4, fontSize: 15, fontWeight: "700" },
    hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 14, lineHeight: 16 },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 14,
    },
    row: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: colors.textSecondary, fontWeight: "600", fontSize: 14 },
    saveBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
