import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Camera, useCameraDevice, useCameraPermission, useFrameOutput, usePhotoOutput } from "react-native-vision-camera";
import { useResizer } from "react-native-vision-camera-resizer";
import { NitroModules } from "react-native-nitro-modules";
import { runOnJS } from "react-native-worklets";
import { useSharedValue } from "react-native-reanimated";
import { loadTensorflowModel, type TfliteModel } from "react-native-fast-tflite";
import { bytesToBase64 } from "../lib/api";
import { colorForClass } from "../lib/classColors";
import { detectObjects, NUM_ANCHORS, NUM_MASK_COEFFS } from "../lib/decodeSegmentation";
import { getPinnedModel, processLiveFrame, startLiveSession, stopLiveSession } from "../lib/liveInferenceApi";
import { getActiveModelUri } from "../lib/modelManager";
import { CORROSION_CLASS_NAMES } from "../lib/onDeviceInference";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { LocalPhoto, VisionSession } from "../types";

/**
 * Real-time camera scanning — points the phone at a surface and shows
 * corrosion detections update live, for both the on-device TFLite model
 * (no network, real frame-processor pipeline) and the server model (reuses
 * the existing live-inference endpoints built for the web app's QA camera).
 *
 * A "live" detection here is a fast bounding-box preview to help aim/scan —
 * the precise corrosion % still comes from the normal capture → Upload/
 * Inspect-on-device → Confirm pipeline. Tapping Capture hands the current
 * raw frame back to CaptureScreen exactly like the regular Camera button.
 */

const MODEL_SIZE = 640;
const ON_DEVICE_FRAME_INTERVAL_MS = 220; // ~4-5fps — plenty for an overlay, keeps thermal load sane
const CONFIDENCE_THRESHOLD = 0.2; // matches the on-device batch inspect + server default
const SERVER_FRAME_GAP_MS = 60;

type LiveMode = "on-device" | "server";

type Box = {
  key: string;
  label: string;
  color: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function LiveInspectScreen({
  session,
  projectName,
  onCapture,
  onClose,
}: {
  session: VisionSession;
  projectName: string;
  onCapture: (photo: LocalPhoto) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ quality: 0.6 });

  const [mode, setMode] = useState<LiveMode>("on-device");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [sourceSize, setSourceSize] = useState({ width: MODEL_SIZE, height: MODEL_SIZE });
  const [layoutSize, setLayoutSize] = useState({ width: 0, height: 0 });
  const [capturing, setCapturing] = useState(false);
  // Shared between the manual Capture button and the server-mode polling
  // loop below — both call photoOutput.capturePhoto() and must never overlap.
  const captureBusyRef = useRef(false);

  // --- on-device model + frame processor ---
  const [model, setModel] = useState<TfliteModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "on-device" || model) return;
    let cancelled = false;
    (async () => {
      try {
        const { uri } = await getActiveModelUri();
        const loaded = await loadTensorflowModel({ url: uri }, []);
        if (!cancelled) setModel(loaded);
      } catch (err) {
        if (!cancelled) setModelError(err instanceof Error ? err.message : "Could not load on-device model");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, model]);

  // Frame-processor worklets run on a separate thread and can't touch plain
  // JS/Nitro objects directly — boxing makes the model callable from there.
  const boxedModel = useMemo(() => (model ? NitroModules.box(model) : undefined), [model]);

  const { resizer } = useResizer({
    width: MODEL_SIZE,
    height: MODEL_SIZE,
    channelOrder: "rgb",
    dataType: "float32",
    scaleMode: "stretch", // matches the existing on-device photo pipeline's resize — no letterboxing
    pixelLayout: "interleaved", // model expects NHWC, same as the batch inspect path
  });

  const PRED_ROWS_SENT = 4 + CORROSION_CLASS_NAMES.length; // box coords + class scores only — mask coeffs unused for the bbox-only live overlay
  const FULL_PRED_ROWS = 4 + CORROSION_CLASS_NAMES.length + NUM_MASK_COEFFS; // matches the model's real output shape, so detectObjects can index it safely

  const handleOnDeviceOutput = useCallback(
    (slimPredictionsArray: number[], frameWidth: number, frameHeight: number, frameOrientation: string) => {
      // The worklet only sends the rows this screen actually uses (see below) —
      // rebuild a full-size, zero-padded array so detectObjects can index it
      // exactly like it does for the batch inspect path.
      const predictions = new Float32Array(FULL_PRED_ROWS * NUM_ANCHORS);
      predictions.set(slimPredictionsArray);
      const detections = detectObjects(predictions, CORROSION_CLASS_NAMES.length, CONFIDENCE_THRESHOLD);

      // useCamera() sets each output's `outputOrientation` from the device's
      // current orientation, so the resizer's GPU resize already bakes in
      // the rotation — the 640x640 model input represents the UPRIGHT view
      // (just squished to a square), not the raw landscape sensor buffer.
      // Confirmed empirically: scaling model-space by the raw sensor
      // dimensions gave a ~1.7:1 aspect on a circular bolt; scaling by the
      // rotated (upright) dimensions instead gives ~1:1, as it should.
      const rotated = frameOrientation === "right" || frameOrientation === "left";
      const upW = rotated ? frameHeight : frameWidth;
      const upH = rotated ? frameWidth : frameHeight;
      setSourceSize({ width: upW, height: upH });

      setBoxes(
        detections.map((d, i) => {
          const label = CORROSION_CLASS_NAMES[d.classId] ?? `class ${d.classId}`;
          // Verified empirically against the proven batch pipeline on the
          // same static scene: X matched directly, but Y was consistently
          // mirrored (live_Y ≈ 100% - proven_Y) — flip Y here to correct it.
          const y1raw = (1 - d.y2 / MODEL_SIZE) * upH;
          const y2raw = (1 - d.y1 / MODEL_SIZE) * upH;
          return {
            key: `${i}`,
            label,
            color: colorForClass({ class: label, classId: d.classId }),
            confidence: d.confidence,
            x1: (d.x1 / MODEL_SIZE) * upW,
            y1: y1raw,
            x2: (d.x2 / MODEL_SIZE) * upW,
            y2: y2raw,
          };
        })
      );
    },
    []
  );

  const logDiag = useCallback((msg: string, extra?: Record<string, unknown>) => {
    console.log("[DIAG]", msg, extra ?? "");
  }, []);

  const lastRunTime = useSharedValue(0);
  const frameOutput = useFrameOutput({
    pixelFormat: "yuv",
    // Without this, the frame stream defaults to a fixed HD 16:9 crop of the
    // sensor while the preview shows a different (often 4:3) field of view —
    // two different crops of the same scene, not just different resolutions
    // of the same one. This makes the frame output match the preview's FOV
    // so a detection's position actually corresponds to what's on screen.
    enablePreviewSizedOutputBuffers: true,
    onFrame(frame) {
      "worklet";
      if (boxedModel == null || resizer == null) {
        runOnJS(logDiag)("onFrame skipped: not ready", { hasModel: boxedModel != null, hasResizer: resizer != null });
        frame.dispose();
        return;
      }
      const now = Date.now();
      if (now - lastRunTime.value < ON_DEVICE_FRAME_INTERVAL_MS) {
        frame.dispose();
        return;
      }
      lastRunTime.value = now;
      const frameWidth = frame.width;
      const frameHeight = frame.height;
      const frameOrientation = frame.orientation;
      // Every acquired frame (and any resized copy of it) MUST be disposed
      // exactly once, even on failure — VisionCamera draws frames from a
      // fixed-size native buffer pool, and a leaked frame from a skipped
      // dispose() on an error path eventually exhausts that pool and crashes
      // the app outright, not just this one frame.
      let resized: ReturnType<typeof resizer.resize> | undefined;
      try {
        resized = resizer.resize(frame);
        const buffer = resized.getPixelBuffer();
        const tflite = boxedModel.unbox();
        const outputs = tflite.runSync([buffer]);
        // Raw ArrayBuffers don't survive the runOnJS worklet->JS bridge in
        // this worklets version (arrives as undefined on the other side) —
        // convert to a plain number array first, which does survive it. Only
        // send the rows this screen actually uses (box coords + class
        // scores) — the 32 mask-coefficient rows are ~5x the payload and
        // unused for the bbox-only live overlay, and were the main source of
        // per-frame lag.
        const slim = new Float32Array(outputs[0], 0, PRED_ROWS_SENT * NUM_ANCHORS);
        const predictionsArray = Array.from(slim);
        runOnJS(handleOnDeviceOutput)(predictionsArray, frameWidth, frameHeight, frameOrientation);
      } catch (err) {
        runOnJS(logDiag)("onFrame error", { message: String(err) });
      } finally {
        resized?.dispose();
        frame.dispose();
      }
    },
  });

  // --- server live session ---
  const [serverInferenceId, setServerInferenceId] = useState<string | null>(null);
  const [serverStarting, setServerStarting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "server") return;
    let cancelled = false;
    setServerStarting(true);
    setServerError(null);
    (async () => {
      try {
        const pin = await getPinnedModel(session, projectName);
        if (!pin) throw new Error("No mobile inspect model is pinned for this project.");
        const started = await startLiveSession(session, pin.mongoModelId, pin.confidenceThreshold);
        if (!cancelled) setServerInferenceId(started.inferenceId);
      } catch (err) {
        if (!cancelled) setServerError(err instanceof Error ? err.message : "Could not start live session");
      } finally {
        if (!cancelled) setServerStarting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, session, projectName]);

  // Stops the previous server session whenever the id changes away from it
  // (mode switch) or the screen unmounts — single source of truth for cleanup.
  useEffect(() => {
    return () => {
      if (serverInferenceId) stopLiveSession(session, serverInferenceId);
    };
  }, [session, serverInferenceId]);

  useEffect(() => {
    if (mode !== "server" || !serverInferenceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      // The manual Capture button uses this same photoOutput — skip this
      // tick rather than firing a second concurrent capturePhoto() on top
      // of it, which cameras generally don't handle safely.
      if (captureBusyRef.current) {
        timer = setTimeout(tick, SERVER_FRAME_GAP_MS);
        return;
      }
      captureBusyRef.current = true;
      try {
        const photo = await photoOutput.capturePhoto({}, {});
        const data = await photo.getFileDataAsync();
        const width = photo.width;
        const height = photo.height;
        photo.dispose();
        const base64 = bytesToBase64(new Uint8Array(data));
        const result = await processLiveFrame(session, serverInferenceId, base64);
        if (!cancelled) {
          setSourceSize({ width: result.imageWidth || width, height: result.imageHeight || height });
          setBoxes(
            result.detections.map((d, i) => ({
              key: `${i}`,
              label: d.class,
              color: colorForClass({ class: d.class }),
              confidence: d.confidence,
              x1: d.bbox[0],
              y1: d.bbox[1],
              x2: d.bbox[2],
              y2: d.bbox[3],
            }))
          );
        }
      } catch {
        // Transient (network hiccup, session hiccup) — keep looping.
      } finally {
        captureBusyRef.current = false;
        if (!cancelled) timer = setTimeout(tick, SERVER_FRAME_GAP_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mode, serverInferenceId, session, photoOutput]);

  const switchMode = (next: LiveMode) => {
    if (next === mode) return;
    setBoxes([]);
    setServerInferenceId(null);
    setMode(next);
  };

  const capture = async () => {
    if (captureBusyRef.current) return;
    captureBusyRef.current = true;
    setCapturing(true);
    try {
      const photo = await photoOutput.capturePhoto({}, {});
      const path = await photo.saveToTemporaryFileAsync();
      photo.dispose();
      const localPhoto = {
        uri: `file://${path}`,
        fileName: `live_${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      };
      onCapture(localPhoto);
    } catch (err) {
      Alert.alert("Capture failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      captureBusyRef.current = false;
      setCapturing(false);
    }
  };

  const onCameraLayout = (e: LayoutChangeEvent) => {
    setLayoutSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  };

  // "cover" crop math — matches how the live preview itself fills its bounds,
  // so boxes line up with what's actually visible on screen.
  const scale =
    layoutSize.width > 0 && sourceSize.width > 0
      ? Math.max(layoutSize.width / sourceSize.width, layoutSize.height / sourceSize.height)
      : 0;
  const offsetX = scale ? (sourceSize.width * scale - layoutSize.width) / 2 : 0;
  const offsetY = scale ? (sourceSize.height * scale - layoutSize.height) / 2 : 0;

  if (!hasPermission) {
    return (
      <View style={styles.permissionRoot}>
        <Ionicons name="camera-outline" size={40} color={colors.textMuted} />
        <Text style={styles.permissionText}>Camera access is needed for live scanning.</Text>
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 16 }}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionRoot}>
        <Text style={styles.permissionText}>No camera found on this device.</Text>
        <Pressable onPress={onClose} style={{ marginTop: 16 }}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onCameraLayout}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={mode === "on-device" ? [photoOutput, frameOutput] : [photoOutput]}
      />

      {scale > 0 &&
        boxes.map((b) => (
          <View
            key={b.key}
            pointerEvents="none"
            style={[
              styles.box,
              {
                borderColor: b.color,
                left: b.x1 * scale - offsetX,
                top: b.y1 * scale - offsetY,
                width: Math.max(0, (b.x2 - b.x1) * scale),
                height: Math.max(0, (b.y2 - b.y1) * scale),
              },
            ]}
          >
            <Text style={[styles.boxLabel, { backgroundColor: b.color }]} numberOfLines={1}>
              {b.label} {Math.round(b.confidence * 100)}%
            </Text>
          </View>
        ))}

      <View style={styles.topBar}>
        <Pressable onPress={onClose} style={styles.iconBtn}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeBtn, mode === "on-device" && styles.modeBtnActive]}
            onPress={() => switchMode("on-device")}
          >
            <Text style={[styles.modeText, mode === "on-device" && styles.modeTextActive]}>On-device</Text>
          </Pressable>
          <Pressable style={[styles.modeBtn, mode === "server" && styles.modeBtnActive]} onPress={() => switchMode("server")}>
            <Text style={[styles.modeText, mode === "server" && styles.modeTextActive]}>Server</Text>
          </Pressable>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.statusBar}>
        {mode === "on-device" ? (
          modelError ? (
            <Text style={styles.statusTextError}>{modelError}</Text>
          ) : !boxedModel ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.statusText}>Loading on-device model…</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>
              {boxes.length} detection{boxes.length === 1 ? "" : "s"} · live, offline
            </Text>
          )
        ) : serverError ? (
          <Text style={styles.statusTextError}>{serverError}</Text>
        ) : serverStarting ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.statusText}>Starting server session…</Text>
          </View>
        ) : (
          <Text style={styles.statusText}>
            {boxes.length} detection{boxes.length === 1 ? "" : "s"} · via server
          </Text>
        )}
        <Text style={styles.statusHint}>Live preview is a scanning aid — exact % comes from a captured inspect.</Text>
      </View>

      <View style={styles.bottomBar}>
        <Pressable style={[styles.captureBtn, capturing && styles.captureBtnBusy]} onPress={capture} disabled={capturing}>
          {capturing ? <ActivityIndicator color="#0f172a" /> : <Ionicons name="camera" size={26} color="#0f172a" />}
        </Pressable>
        <Text style={styles.captureHint}>Capture adds this frame to the part's photos</Text>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: "#000" },
    permissionRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
    permissionText: { color: colors.textSecondary, textAlign: "center", marginTop: 12, lineHeight: 20 },
    permissionBtn: { marginTop: 16, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
    permissionBtnText: { color: "#fff", fontWeight: "700" },
    link: { color: colors.accentText, fontWeight: "600" },
    box: { position: "absolute", borderWidth: 2, borderRadius: 4 },
    boxLabel: {
      position: "absolute",
      top: -20,
      left: -2,
      color: "#0f172a",
      fontSize: 11,
      fontWeight: "700",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: "hidden",
    },
    topBar: {
      position: "absolute",
      top: 52,
      left: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: "rgba(15,23,42,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    modeToggle: { flexDirection: "row", backgroundColor: "rgba(15,23,42,0.6)", borderRadius: 999, padding: 3 },
    modeBtn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999 },
    modeBtnActive: { backgroundColor: colors.accent },
    modeText: { color: "rgba(255,255,255,0.7)", fontWeight: "600", fontSize: 13 },
    modeTextActive: { color: "#fff" },
    statusBar: { position: "absolute", top: 104, left: 16, right: 16, alignItems: "center" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusText: { color: "#fff", fontWeight: "600", fontSize: 13 },
    statusTextError: { color: "#fca5a5", fontWeight: "600", fontSize: 13, textAlign: "center" },
    statusHint: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 4, textAlign: "center" },
    bottomBar: { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center" },
    captureBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: "#fff",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 4,
      borderColor: "rgba(255,255,255,0.4)",
    },
    captureBtnBusy: { opacity: 0.6 },
    captureHint: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 10 },
  });
}
