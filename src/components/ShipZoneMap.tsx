import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";

/**
 * A tappable ship silhouette used both as an area picker (CaptureScreen's
 * ShipAreaPicker) and as a per-survey condition overview
 * (SurveyDashboardScreen). Visually mirrors the web dashboard's
 * VesselConditionMap (hull, bridge, funnel, deck containers) but is built
 * from plain Views — this app avoids react-native-svg for decorative UI, so
 * the tapered bow is a CSS-border triangle rather than an SVG path.
 *
 * 15 zones need real tap targets, so this renders on a horizontally
 * scrollable wide canvas rather than squeezing everything into one screen
 * width.
 */
export type ShipZone = {
  area: string;
  color: string;
  subtitle?: string;
};

const COLUMN_WIDTH = 62;
const SIDE_PADDING = 20;
const HULL_TOP = 66;
const HULL_HEIGHT = 52;
const BOW_WIDTH = 34;
const DOT_SIZE = 20;
const DOT_CENTER_Y = HULL_TOP + HULL_HEIGHT / 2;
const TOP_SPACER = DOT_CENTER_Y - DOT_SIZE / 2;
const GAP_BELOW_HULL = HULL_TOP + HULL_HEIGHT - (TOP_SPACER + DOT_SIZE) + 12;

export function ShipZoneMap({
  zones,
  onSelectZone,
}: {
  zones: ShipZone[];
  onSelectZone: (area: string) => void;
}) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hullColor = scheme === "light" ? "#334155" : "#cbd5e1";
  const canvasWidth = SIDE_PADDING * 2 + COLUMN_WIDTH * zones.length;

  const hullLeft = SIDE_PADDING - 10;
  const hullRight = canvasWidth - SIDE_PADDING + 10;
  const bowTipX = hullRight;
  const hullRectRight = bowTipX - BOW_WIDTH;

  const bridgeWidth = 52;
  const bridgeHeight = 26;
  const bridgeLeft = hullRectRight - bridgeWidth - 46;
  const funnelLeft = bridgeLeft + bridgeWidth + 12;
  const funnelWidth = 16;
  const funnelHeight = 24;

  const containerSlots = [
    { left: hullLeft + 24, width: 36, height: 16 },
    { left: hullLeft + 76, width: 30, height: 22 },
    { left: hullLeft + 122, width: 34, height: 15 },
  ].filter((c) => c.left + c.width < bridgeLeft - 16);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingVertical: 4 }}>
      <View style={[styles.canvas, { width: canvasWidth }]}>
        {/* waterline */}
        <View
          style={[
            styles.waterline,
            { left: 4, right: 4, top: HULL_TOP + HULL_HEIGHT + 6, borderTopColor: colors.textMuted },
          ]}
        />

        {/* hull body (stern rounded on the left, squared where the bow triangle attaches) */}
        <View
          style={[
            styles.hull,
            {
              left: hullLeft,
              width: hullRectRight - hullLeft,
              top: HULL_TOP,
              height: HULL_HEIGHT,
              borderTopLeftRadius: HULL_HEIGHT / 2,
              borderBottomLeftRadius: HULL_HEIGHT / 2,
              backgroundColor: hullColor,
            },
          ]}
        />
        {/* bow taper — CSS-border triangle, since there's no SVG here */}
        <View
          style={{
            position: "absolute",
            left: hullRectRight,
            top: HULL_TOP,
            width: 0,
            height: 0,
            borderTopWidth: HULL_HEIGHT / 2,
            borderBottomWidth: HULL_HEIGHT / 2,
            borderLeftWidth: BOW_WIDTH,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            borderLeftColor: hullColor,
          }}
        />
        {/* waterline shade along the hull bottom */}
        <View
          style={{
            position: "absolute",
            left: hullLeft,
            width: hullRectRight - hullLeft,
            top: HULL_TOP + HULL_HEIGHT - 10,
            height: 10,
            borderBottomLeftRadius: HULL_HEIGHT / 2,
            backgroundColor: "#000",
            opacity: 0.14,
          }}
        />

        {/* deck containers, decorative, low-opacity so they don't compete with the pins */}
        {containerSlots.map((c, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: c.left,
              top: HULL_TOP - c.height,
              width: c.width,
              height: c.height,
              backgroundColor: hullColor,
              opacity: 0.35,
              borderRadius: 2,
            }}
          />
        ))}

        {/* bridge / superstructure */}
        <View
          style={{
            position: "absolute",
            left: bridgeLeft,
            top: HULL_TOP - bridgeHeight,
            width: bridgeWidth,
            height: bridgeHeight,
            backgroundColor: hullColor,
            borderRadius: 3,
          }}
        />
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: bridgeLeft + 8 + i * 14,
              top: HULL_TOP - 12,
              width: 8,
              height: 7,
              backgroundColor: colors.surface,
              borderRadius: 1,
              opacity: 0.9,
            }}
          />
        ))}
        {/* mast */}
        <View
          style={{
            position: "absolute",
            left: bridgeLeft + bridgeWidth / 2 - 1,
            top: HULL_TOP - bridgeHeight - 16,
            width: 2,
            height: 16,
            backgroundColor: hullColor,
          }}
        />

        {/* funnel with an accent stripe */}
        <View
          style={{
            position: "absolute",
            left: funnelLeft,
            top: HULL_TOP - funnelHeight,
            width: funnelWidth,
            height: funnelHeight,
            backgroundColor: hullColor,
            borderRadius: 2,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: funnelLeft,
            top: HULL_TOP - funnelHeight,
            width: funnelWidth,
            height: 8,
            backgroundColor: colors.accent,
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
          }}
        />

        <View style={[styles.row, { paddingHorizontal: SIDE_PADDING }]}>
          {zones.map((zone) => (
            <Pressable
              key={zone.area}
              style={styles.column}
              onPress={() => onSelectZone(zone.area)}
              hitSlop={4}
            >
              <View style={{ height: TOP_SPACER }} />
              <View style={[styles.dot, { backgroundColor: zone.color, borderColor: colors.surface }]} />
              <View style={{ height: GAP_BELOW_HULL }} />
              <Text style={styles.label} numberOfLines={2}>
                {zone.area}
              </Text>
              {zone.subtitle ? (
                <Text style={[styles.subtitle, { color: zone.color }]} numberOfLines={1}>
                  {zone.subtitle}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    canvas: { position: "relative" },
    hull: { position: "absolute" },
    waterline: { position: "absolute", borderTopWidth: 1.5, borderStyle: "dashed", opacity: 0.5 },
    row: { flexDirection: "row" },
    column: { width: COLUMN_WIDTH, alignItems: "center" },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      borderWidth: 2.5,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    label: { color: colors.textSecondary, fontSize: 10, textAlign: "center", marginTop: 6, lineHeight: 13 },
    subtitle: { fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 2 },
  });
}
