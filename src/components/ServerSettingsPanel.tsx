import { useState } from "react";
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

/**
 * Lets the crew member point the app at a new backend address (new WiFi, new
 * tunnel URL, laptop restarted, etc.) from the phone itself, with no rebuild.
 *
 * Renders as a modal dialog rather than inline content — that keeps its
 * keyboard handling self-contained instead of depending on whatever
 * scroll/layout setup the screen it's opened from happens to have.
 */
export function ServerSettingsPanel({ onSaved }: { onSaved?: () => void }) {
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
              placeholderTextColor="#64748b"
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

const styles = StyleSheet.create({
  linkWrap: { marginTop: 16, alignItems: "center" },
  link: { color: "#64748b", fontSize: 13, textDecorationLine: "underline" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.85)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  label: { color: "#f8fafc", marginBottom: 4, fontSize: 15, fontWeight: "700" },
  hint: { color: "#94a3b8", fontSize: 12, marginBottom: 14, lineHeight: 16 },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
  cancelText: { color: "#94a3b8", fontWeight: "600", fontSize: 14 },
  saveBtn: { backgroundColor: "#ea580c", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
