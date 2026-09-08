import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COMMON_SHIP_AREAS } from "../lib/shipAreas";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

/**
 * A text-input-styled field that opens a picker of common ship areas, with
 * a "type your own" fallback — not a strict enum, just a shortcut so the
 * corrosion dashboard can reliably group findings by area.
 */
export function ShipAreaPicker({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState("");

  const openPicker = () => {
    setCustomMode(false);
    setDraft(value);
    setOpen(true);
  };

  const pick = (area: string) => {
    onChangeText(area);
    setOpen(false);
  };

  const confirmCustom = () => {
    const trimmed = draft.trim();
    if (trimmed) onChangeText(trimmed);
    setOpen(false);
  };

  return (
    <>
      <Pressable style={styles.field} onPress={openPicker}>
        <Text style={value ? styles.value : styles.placeholder} numberOfLines={1}>
          {value || placeholder || "Choose an area"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {customMode ? (
              <>
                <Text style={styles.title}>Type the area</Text>
                <TextInput
                  style={styles.customInput}
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  placeholder="e.g. Cargo hold 3 starboard"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.row}>
                  <Pressable onPress={() => setCustomMode(false)} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>Back to list</Text>
                  </Pressable>
                  <Pressable style={styles.saveBtn} onPress={confirmCustom} disabled={!draft.trim()}>
                    <Text style={styles.saveBtnText}>Use this</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>Ship area</Text>
                <ScrollView style={{ maxHeight: 340 }}>
                  {COMMON_SHIP_AREAS.map((area) => (
                    <Pressable key={area} style={styles.row_item} onPress={() => pick(area)}>
                      <Text style={styles.rowText}>{area}</Text>
                      {area === value ? (
                        <Ionicons name="checkmark" size={18} color={colors.accentText} />
                      ) : null}
                    </Pressable>
                  ))}
                  <Pressable style={styles.row_item} onPress={() => setCustomMode(true)}>
                    <Text style={[styles.rowText, { color: colors.accentText, fontWeight: "700" }]}>
                      Other (type your own)…
                    </Text>
                  </Pressable>
                </ScrollView>
                <Pressable onPress={() => setOpen(false)} style={styles.closeBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    value: { color: colors.textPrimary, fontSize: 15, flex: 1, marginRight: 8 },
    placeholder: { color: colors.textMuted, fontSize: 15, flex: 1, marginRight: 8 },
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
    title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700", marginBottom: 10 },
    row_item: {
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    rowText: { color: colors.textPrimary, fontSize: 15 },
    closeBtn: { marginTop: 14, alignItems: "center", paddingVertical: 8 },
    customInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      marginBottom: 14,
    },
    row: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: colors.textSecondary, fontWeight: "600", fontSize: 14 },
    saveBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
