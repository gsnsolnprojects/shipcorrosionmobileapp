import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchAuthImageDataUrl } from "../lib/api";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { VisionSession } from "../types";

export function AuthImage({
  url,
  session,
  height = 220,
  resizeMode = "contain",
  onPress,
}: {
  url: string;
  session: VisionSession;
  height?: number;
  resizeMode?: "cover" | "contain";
  onPress?: (dataUrl: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    // On-device results are already a local data: URI — no server, no auth needed.
    if (url.startsWith("data:")) {
      setDataUrl(url);
      return;
    }
    fetchAuthImageDataUrl(session, url).then((next) => {
      if (cancelled) return;
      if (next) setDataUrl(next);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [url, session]);

  if (failed) {
    return (
      <View style={[styles.box, { height }]}>
        <Text style={styles.fail}>Could not load annotated image</Text>
      </View>
    );
  }

  if (!dataUrl) {
    return (
      <View style={[styles.box, { height }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const image = (
    <View style={[styles.box, { height }]}>
      <Image source={{ uri: dataUrl }} style={styles.image} resizeMode={resizeMode} />
      {onPress ? <Text style={styles.hint}>Tap to open full image · pinch to zoom</Text> : null}
    </View>
  );

  if (!onPress) return image;

  return (
    <Pressable onPress={() => onPress(dataUrl)} accessibilityRole="imagebutton">
      {image}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    image: {
      width: "100%",
      height: "100%",
      backgroundColor: colors.surfaceAlt,
    },
    // Overlaid on top of a photo, not app chrome — stays white+shadow
    // regardless of theme so it's legible against any image content.
    hint: {
      position: "absolute",
      bottom: 8,
      left: 8,
      right: 8,
      textAlign: "center",
      color: "#f8fafc",
      fontSize: 12,
      fontWeight: "600",
      textShadowColor: "rgba(0,0,0,0.8)",
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    fail: {
      color: colors.textSecondary,
      fontSize: 13,
    },
  });
}
