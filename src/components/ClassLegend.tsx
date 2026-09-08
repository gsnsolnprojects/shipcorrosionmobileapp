import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  colorForClass,
  uniqueClassItems,
  type ClassLegendItem,
} from "../lib/classColors";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

function formatPct(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return `${n.toFixed(2)}%`;
}

export function ClassLegend({
  items,
  title = "Mask colors",
  showStats = false,
  classNames,
}: {
  items: ClassLegendItem[] | undefined | null;
  title?: string;
  showStats?: boolean;
  classNames?: string[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rows = uniqueClassItems(items, classNames);
  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>Same colors as the tinted masks on inspect photos.</Text>
      {rows.map((row) => {
        const pct = formatPct(row.meanPercent ?? row.percent);
        return (
          <View key={row.class} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: colorForClass(row, classNames) }]} />
            <Text style={styles.name}>{row.class}</Text>
            {showStats ? (
              <Text style={styles.stats}>
                {pct ?? "—"}
                {typeof row.count === "number" ? ` · ${row.count}` : ""}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    title: {
      color: colors.textPrimary,
      fontWeight: "700",
      fontSize: 13,
      marginBottom: 4,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 11,
      marginBottom: 8,
      lineHeight: 16,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 6,
      gap: 10,
    },
    swatch: {
      width: 16,
      height: 16,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.35)",
    },
    name: {
      color: colors.textPrimary,
      fontWeight: "600",
      fontSize: 14,
      flex: 1,
    },
    stats: {
      color: colors.textSecondary,
      fontSize: 12,
    },
  });
}
