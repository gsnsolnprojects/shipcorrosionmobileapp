import { StyleSheet, View, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeContext";

type BgIcon = {
  name: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  size: number;
  opacity?: number;
  style: ViewStyle;
};

/** A faint layer of nautical icon watermarks behind a screen's real content. */
export function NauticalBackground({ icons }: { icons: BgIcon[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fill} pointerEvents="none">
      {icons.map((icon, i) => (
        <MaterialCommunityIcons
          key={i}
          name={icon.name}
          size={icon.size}
          color={colors.textSecondary}
          style={[styles.icon, { opacity: icon.opacity ?? 0.16 }, icon.style]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  icon: { position: "absolute" },
});
