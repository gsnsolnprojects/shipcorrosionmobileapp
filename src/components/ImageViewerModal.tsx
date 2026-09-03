import { useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ClassLegend } from "./ClassLegend";
import type { ClassLegendItem } from "../lib/classColors";

type Props = {
  visible: boolean;
  uri: string | null;
  title?: string;
  subtitle?: string;
  legendItems?: ClassLegendItem[] | null;
  classNames?: string[];
  onClose: () => void;
};

function touchDistance(touches: { pageX: number; pageY: number }[]) {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

export function ImageViewerModal({ visible, uri, title, subtitle, legendItems, classNames, onClose }: Props) {
  const { width, height } = Dimensions.get("window");
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(1);
  const translateValue = useRef({ x: 0, y: 0 });
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const lastTap = useRef(0);
  const [ready, setReady] = useState(false);

  const resetTransform = () => {
    scaleValue.current = 1;
    translateValue.current = { x: 0, y: 0 };
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) =>
          g.numberActiveTouches >= 2 || (scaleValue.current > 1 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)),
        onPanResponderGrant: (e) => {
          const now = Date.now();
          if (e.nativeEvent.touches.length === 1 && now - lastTap.current < 280) {
            if (scaleValue.current > 1) {
              resetTransform();
            } else {
              scaleValue.current = 2.5;
              scale.setValue(2.5);
            }
            lastTap.current = 0;
            return;
          }
          lastTap.current = now;
          if (e.nativeEvent.touches.length >= 2) {
            pinchStartDistance.current = touchDistance(e.nativeEvent.touches);
            pinchStartScale.current = scaleValue.current;
          }
        },
        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const d = touchDistance(touches);
            if (pinchStartDistance.current > 8) {
              const next = Math.min(6, Math.max(1, pinchStartScale.current * (d / pinchStartDistance.current)));
              scaleValue.current = next;
              scale.setValue(next);
            }
            return;
          }
          if (scaleValue.current > 1) {
            translateX.setValue(translateValue.current.x + g.dx);
            translateY.setValue(translateValue.current.y + g.dy);
          }
        },
        onPanResponderRelease: (_, g) => {
          if (scaleValue.current > 1 && g.numberActiveTouches < 2) {
            translateValue.current = {
              x: translateValue.current.x + g.dx,
              y: translateValue.current.y + g.dy,
            };
          }
          if (scaleValue.current <= 1.02) {
            resetTransform();
          }
        },
      }),
    [scale, translateX, translateY]
  );

  const handleClose = () => {
    resetTransform();
    setReady(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <View style={styles.topText}>
            {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
            {subtitle ? <Text style={styles.sub} numberOfLines={2}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
            <Ionicons name="close" size={16} color="#fff" />
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {uri ? (
          <View style={styles.stage} {...panResponder.panHandlers}>
            <Animated.Image
              source={{ uri }}
              resizeMode="contain"
              onLoad={() => setReady(true)}
              style={{
                width,
                height: height - 88,
                opacity: ready ? 1 : 0.3,
                transform: [{ translateX }, { translateY }, { scale }],
              }}
            />
          </View>
        ) : null}

        {legendItems && legendItems.length > 0 ? (
          <View style={styles.legendBar}>
            <ClassLegend items={legendItems} classNames={classNames} title="Mask colors" />
          </View>
        ) : null}
        <Text style={styles.help}>Pinch to zoom · double-tap to zoom · drag when zoomed</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    paddingTop: 44,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  topText: { flex: 1 },
  title: { color: "#f8fafc", fontSize: 16, fontWeight: "700" },
  sub: { color: "#cbd5e1", fontSize: 12, marginTop: 4 },
  closeBtn: {
    backgroundColor: "#ea580c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  closeText: { color: "#fff", fontWeight: "700" },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  help: {
    color: "#94a3b8",
    textAlign: "center",
    fontSize: 12,
    paddingVertical: 12,
  },
  legendBar: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});
