import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeContext";

/** Small icon button, reachable from every screen header, that toggles light/dark. */
export function ThemeToggle() {
  const { scheme, colors, setPreference } = useTheme();

  return (
    <Pressable
      onPress={() => setPreference(scheme === "dark" ? "light" : "dark")}
      style={[styles.btn, { borderColor: colors.surfaceBorder, backgroundColor: colors.surface }]}
      hitSlop={8}
    >
      <Ionicons
        name={scheme === "dark" ? "moon" : "sunny"}
        size={16}
        color={scheme === "dark" ? colors.textSecondary : colors.accentText}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
