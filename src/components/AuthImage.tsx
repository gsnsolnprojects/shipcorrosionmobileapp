import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchAuthImageDataUrl } from "../lib/api";
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
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
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
        <ActivityIndicator color="#f97316" />
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

const styles = StyleSheet.create({
  box: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "#1e293b",
  },
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
    color: "#94a3b8",
    fontSize: 13,
  },
});
