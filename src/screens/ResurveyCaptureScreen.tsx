import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AuthImage } from "../components/AuthImage";
import { NauticalBackground } from "../components/NauticalBackground";
import { ThemeToggle } from "../components/ThemeToggle";
import { fetchAuthImageDataUrl } from "../lib/api";
import { enqueuePart } from "../lib/offlineQueue";
import { CORROSION_CLASS_NAMES, runOnDeviceInspection } from "../lib/onDeviceInference";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { InspectResults, LocalPhoto, PhotoMatch, ResultImage, VisionSession } from "../types";

export type ResurveyBaseline = {
  inferenceId: string;
  regionName: string;
  images: ResultImage[];
};

type CaptureMode = "reference" | "overlay";
type CameraTarget = "step" | "extra";

function photoFromAsset(asset: ImagePicker.ImagePickerAsset, index: number): LocalPhoto {
  const uri = asset.uri;
  const mimeType = asset.mimeType || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const fileName = asset.fileName || `photo_${Date.now()}_${index}.${ext}`;
  return { uri, fileName, mimeType };
}

export function ResurveyCaptureScreen({
  session,
  projectName,
  surveyName,
  baseline,
  onBack,
  onSubmitOnDevice,
  onSubmitServer,
}: {
  session: VisionSession;
  projectName: string;
  surveyName: string;
  baseline: ResurveyBaseline;
  onBack: () => void;
  onSubmitOnDevice: (results: InspectResults, baseline: ResurveyBaseline, photoMatches: PhotoMatch[]) => void;
  onSubmitServer: (
    regionName: string,
    photos: LocalPhoto[],
    baseline: ResurveyBaseline,
    photoMatches: PhotoMatch[],
    notes: string
  ) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [phase, setPhase] = useState<"steps" | "extra" | "review">(baseline.images.length > 0 ? "steps" : "extra");
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<CaptureMode>("reference");
  const [stepPhotos, setStepPhotos] = useState<Array<LocalPhoto | null>>(() => baseline.images.map(() => null));
  const [extraPhotos, setExtraPhotos] = useState<LocalPhoto[]>([]);

  const [showCamera, setShowCamera] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<CameraTarget>("step");
  const [capturing, setCapturing] = useState(false);
  const [ghostUrl, setGhostUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [notes, setNotes] = useState("");

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const flashOpacity = useRef(new Animated.Value(0)).current;

  const currentBaselineImage = baseline.images[stepIndex] || null;

  // Overlay mode needs the raw baseline photo as a semi-transparent ghost
  // rendered on top of the live camera — fetch its data URL only when it's
  // actually needed (entering overlay mode, or moving to the next step).
  useEffect(() => {
    if (mode !== "overlay" || !currentBaselineImage) {
      setGhostUrl(null);
      return;
    }
    let cancelled = false;
    setGhostUrl(null);
    const url = currentBaselineImage.url;
    if (url.startsWith("data:")) {
      setGhostUrl(url);
      return;
    }
    fetchAuthImageDataUrl(session, url).then((next) => {
      if (!cancelled) setGhostUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, currentBaselineImage, session]);

  const openCamera = async (target: CameraTarget) => {
    const current = permission?.granted ? permission : await requestPermission();
    if (!current.granted) {
      Alert.alert("Camera permission", "Allow camera access to take photos of the equipment.");
      return;
    }
    setCameraTarget(target);
    setShowCamera(true);
  };

  const snap = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (shot?.uri) {
        const photo: LocalPhoto = { uri: shot.uri, fileName: `camera_${Date.now()}.jpg`, mimeType: "image/jpeg" };
        if (cameraTarget === "step") {
          setStepPhotos((prev) => {
            const next = [...prev];
            next[stepIndex] = photo;
            return next;
          });
        } else {
          setExtraPhotos((prev) => [...prev, photo]);
        }
        flashOpacity.setValue(0.85);
        Animated.timing(flashOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start();
        setShowCamera(false);
      }
    } finally {
      setCapturing(false);
    }
  };

  const pickGalleryFor = async (target: CameraTarget) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: target === "extra",
      quality: 0.7,
    });
    if (result.canceled) return;
    if (target === "step") {
      const photo = photoFromAsset(result.assets[0], 0);
      setStepPhotos((prev) => {
        const next = [...prev];
        next[stepIndex] = photo;
        return next;
      });
    } else {
      const names = new Set(extraPhotos.map((p) => p.fileName));
      const incoming = result.assets.map((a, i) => photoFromAsset(a, i)).filter((p) => !names.has(p.fileName));
      setExtraPhotos((prev) => [...prev, ...incoming]);
    }
  };

  const goToNextStep = () => {
    if (stepIndex + 1 < baseline.images.length) {
      setStepIndex((i) => i + 1);
    } else {
      setPhase("extra");
    }
  };

  const skipStep = () => {
    setStepPhotos((prev) => {
      const next = [...prev];
      next[stepIndex] = null;
      return next;
    });
    goToNextStep();
  };

  const retakeStep = () => {
    setStepPhotos((prev) => {
      const next = [...prev];
      next[stepIndex] = null;
      return next;
    });
  };

  const matchedCount = stepPhotos.filter(Boolean).length;
  const skippedCount = stepPhotos.length - matchedCount;
  const totalPhotos = matchedCount + extraPhotos.length;

  const buildPhotosAndMatches = (): { photos: LocalPhoto[]; photoMatches: PhotoMatch[] } => {
    const photos: LocalPhoto[] = [];
    const photoMatches: PhotoMatch[] = [];
    stepPhotos.forEach((photo, i) => {
      if (!photo) return;
      photos.push(photo);
      photoMatches.push({ filename: photo.fileName, matchedBaselineFilename: baseline.images[i]?.filename ?? null });
    });
    extraPhotos.forEach((photo) => {
      photos.push(photo);
      photoMatches.push({ filename: photo.fileName, matchedBaselineFilename: null });
    });
    return { photos, photoMatches };
  };

  const submitServer = async () => {
    if (totalPhotos === 0) return;
    setUploading(true);
    const { photos, photoMatches } = buildPhotosAndMatches();
    try {
      await onSubmitServer(baseline.regionName, photos, baseline, photoMatches, notes.trim());
    } catch (err) {
      // A network-looking failure (no signal) — save on-device instead of
      // losing it, same fallback CaptureScreen's own upload() uses.
      const looksOffline = err instanceof TypeError;
      if (!looksOffline) {
        Alert.alert("Upload failed", err instanceof Error ? err.message : "Try again.");
        return;
      }
      try {
        await enqueuePart({
          companyId: session.companyId,
          companyName: session.companyName,
          projectName,
          surveyName,
          regionName: baseline.regionName,
          photos,
          baselineInferenceId: baseline.inferenceId,
          photoMatches,
          notes: notes.trim(),
        });
        Alert.alert(
          "Saved offline",
          `${photos.length} photo(s) for "${baseline.regionName}" are queued. They'll upload automatically next time you're online.`
        );
        onBack();
      } catch {
        Alert.alert("Upload failed", "No signal, and the photos could not be saved on-device either.");
      }
    } finally {
      setUploading(false);
    }
  };

  const submitOnDevice = async () => {
    if (totalPhotos === 0) return;
    setInspecting(true);
    try {
      const { photos, photoMatches } = buildPhotosAndMatches();
      const matchByFileName = new Map(photoMatches.map((m) => [m.filename, m.matchedBaselineFilename]));
      const batch = await runOnDeviceInspection(photos);
      const images = batch.images.map((img) => ({
        ...img,
        matchedBaselineFilename: matchByFileName.get(img.filename) ?? null,
      }));
      const results: InspectResults = {
        inferenceId: `ondevice_${Date.now()}`,
        regionName: baseline.regionName,
        surveyName,
        images,
        batch: {
          imageCount: photos.length,
          meanCorrosionPercent: batch.meanCorrosionPercent ?? undefined,
          byClass: batch.byClass,
          classNames: [...CORROSION_CLASS_NAMES],
        },
        classNames: [...CORROSION_CLASS_NAMES],
        baselineInferenceId: baseline.inferenceId,
        notes: notes.trim(),
      };
      onSubmitOnDevice(results, baseline, photoMatches);
    } catch (err) {
      Alert.alert("On-device inspect failed", err instanceof Error ? err.message : String(err));
    } finally {
      setInspecting(false);
    }
  };

  if (showCamera) {
    return (
      <View style={styles.cameraRoot}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        {mode === "overlay" && cameraTarget === "step" && ghostUrl ? (
          <Image source={{ uri: ghostUrl }} style={[StyleSheet.absoluteFill, styles.ghost]} resizeMode="cover" />
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flashOpacity }]} />
        <View style={styles.cameraTopBar}>
          <Text style={styles.cameraCount}>
            {cameraTarget === "step"
              ? `Matching photo ${stepIndex + 1} of ${baseline.images.length}`
              : `${extraPhotos.length} extra photo(s)`}
          </Text>
        </View>
        <View style={styles.cameraBar}>
          <Pressable onPress={() => setShowCamera(false)}>
            <Text style={styles.cameraGhost}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.shutter, capturing && styles.shutterDisabled]} onPress={snap} disabled={capturing} />
          <View style={{ width: 56 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <NauticalBackground
        icons={[
          { name: "compass-outline", size: 200, opacity: 0.12, style: { top: -30, right: -40, transform: [{ rotate: "8deg" }] } },
          { name: "ship-wheel", size: 120, opacity: 0.12, style: { bottom: 60, left: -35, transform: [{ rotate: "-14deg" }] } },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Text style={styles.project} numberOfLines={1}>
            {surveyName}
          </Text>
          <ThemeToggle />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.titleRow}>
          <Ionicons name="repeat" size={22} color={colors.accentText} />
          <Text style={styles.title}>Resurvey</Text>
        </View>
        <Text style={styles.lockedRegionName}>{baseline.regionName}</Text>

        {phase === "steps" && currentBaselineImage ? (
          <>
            <Text style={styles.hint}>
              Photo {stepIndex + 1} of {baseline.images.length} — re-shoot this spot from the same place, or skip it.
            </Text>

            <View style={styles.modeTabs}>
              <Pressable
                style={[styles.modeTab, mode === "reference" && styles.modeTabActive]}
                onPress={() => setMode("reference")}
              >
                <Text style={[styles.modeTabText, mode === "reference" && styles.modeTabTextActive]}>Reference</Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, mode === "overlay" && styles.modeTabActive]}
                onPress={() => setMode("overlay")}
              >
                <Text style={[styles.modeTabText, mode === "overlay" && styles.modeTabTextActive]}>Overlay</Text>
              </Pressable>
            </View>
            <Text style={styles.modeInstruction}>
              {mode === "reference"
                ? "Look at the old photo below, then shoot the same spot."
                : "The old photo is ghosted over the live camera — line it up, then shoot."}
            </Text>

            {mode === "reference" ? (
              <AuthImage url={currentBaselineImage.url} session={session} height={180} />
            ) : null}

            {stepPhotos[stepIndex] ? (
              <View style={styles.capturedRow}>
                <Image source={{ uri: stepPhotos[stepIndex]!.uri }} style={styles.capturedThumb} />
                <View style={styles.capturedActions}>
                  <Pressable style={styles.secondary} onPress={retakeStep}>
                    <Ionicons name="refresh" size={16} color={colors.textPrimary} />
                    <Text style={styles.secondaryText}>Retake</Text>
                  </Pressable>
                  <Pressable style={styles.primarySmall} onPress={goToNextStep}>
                    <Text style={styles.primaryText}>Next</Text>
                    <Ionicons name="chevron-forward" size={16} color="#fff" />
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.rowBtns}>
                <Pressable style={styles.secondary} onPress={() => openCamera("step")}>
                  <Ionicons name="camera" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryText}>Camera</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={() => pickGalleryFor("step")}>
                  <Ionicons name="images" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryText}>Gallery</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={skipStep}>
                  <Ionicons name="play-skip-forward" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryText}>Skip</Text>
                </Pressable>
              </View>
            )}

            <Text style={styles.progressLine}>
              {matchedCount} matched · {skippedCount} skipped so far
            </Text>
          </>
        ) : null}

        {phase === "extra" ? (
          <>
            <Text style={styles.hint}>
              Add more photos? Use this for any new damage not captured last time — or skip straight to review.
            </Text>
            <View style={styles.rowBtns}>
              <Pressable style={styles.secondary} onPress={() => openCamera("extra")}>
                <Ionicons name="camera" size={18} color={colors.textPrimary} />
                <Text style={styles.secondaryText}>Camera</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => pickGalleryFor("extra")}>
                <Ionicons name="images" size={18} color={colors.textPrimary} />
                <Text style={styles.secondaryText}>Gallery</Text>
              </Pressable>
            </View>
            <View style={styles.thumbs}>
              {extraPhotos.map((p) => (
                <View key={p.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Pressable
                    style={styles.remove}
                    onPress={() => setExtraPhotos((prev) => prev.filter((x) => x.uri !== p.uri))}
                  >
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Pressable style={styles.primary} onPress={() => setPhase("review")}>
              <Text style={styles.primaryText}>Continue to review</Text>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </Pressable>
          </>
        ) : null}

        {phase === "review" ? (
          <>
            <Text style={styles.hint}>Review before submitting.</Text>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLine}>{matchedCount} matched to the old survey</Text>
              <Text style={styles.summaryLine}>{skippedCount} not re-photographed this cycle</Text>
              <Text style={styles.summaryLine}>{extraPhotos.length} new photo(s)</Text>
            </View>

            <Pressable style={styles.linkRow} onPress={() => setPhase("extra")}>
              <Ionicons name="chevron-back" size={16} color={colors.accentText} />
              <Text style={styles.link}>Back to add photos</Text>
            </Pressable>

            <Text style={styles.notesLabel}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth recording about this re-inspection"
              placeholderTextColor={colors.textMuted}
              style={styles.notesInput}
              multiline
            />

            <Pressable
              style={[styles.primary, (uploading || totalPhotos === 0) && styles.disabled]}
              onPress={submitServer}
              disabled={uploading || totalPhotos === 0}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.primaryText}>Upload & inspect</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[styles.secondaryAction, (inspecting || totalPhotos === 0) && styles.disabled]}
              onPress={submitOnDevice}
              disabled={inspecting || totalPhotos === 0}
            >
              {inspecting ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="hardware-chip-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryActionText}>Inspect on-device</Text>
                </>
              )}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
    linkRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
    link: { color: colors.accentText, fontWeight: "600" },
    project: { color: colors.textSecondary, fontWeight: "600" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700" },
    lockedRegionName: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      fontWeight: "600",
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginTop: 12,
    },
    hint: { color: colors.textSecondary, marginTop: 14, marginBottom: 8, lineHeight: 20 },
    modeTabs: { flexDirection: "row", gap: 8, marginTop: 4 },
    modeTab: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
    },
    modeTabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    modeTabText: { color: colors.textPrimary, fontWeight: "600" },
    modeTabTextActive: { color: "#fff" },
    modeInstruction: { color: colors.textMuted, fontSize: 12, marginTop: 8, marginBottom: 12, lineHeight: 17 },
    rowBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
    secondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    secondaryText: { color: colors.textPrimary, fontWeight: "600" },
    capturedRow: { marginTop: 4 },
    capturedThumb: { width: "100%", height: 180, borderRadius: 10, backgroundColor: colors.surfaceAlt },
    capturedActions: { flexDirection: "row", gap: 10, marginTop: 10 },
    primarySmall: {
      flex: 1,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    progressLine: { color: colors.textMuted, fontSize: 12, marginTop: 14, textAlign: "center" },
    thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    thumbWrap: { width: 96, height: 96 },
    thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: colors.surfaceAlt },
    remove: {
      position: "absolute",
      top: -6,
      right: -6,
      backgroundColor: "#7f1d1d",
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    removeText: { color: "#fff", fontWeight: "700" },
    summaryBox: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      padding: 14,
      marginTop: 8,
      gap: 4,
    },
    summaryLine: { color: colors.textPrimary, fontWeight: "600" },
    notesLabel: { color: colors.textSecondary, marginTop: 18, marginBottom: 6 },
    notesInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 70,
      textAlignVertical: "top",
    },
    primary: {
      backgroundColor: colors.accent,
      marginTop: 20,
      borderRadius: 10,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    disabled: { opacity: 0.45 },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    secondaryAction: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    secondaryActionText: { color: colors.textPrimary, fontWeight: "700", fontSize: 16 },
    // Camera viewfinder is intentionally always dark regardless of app theme.
    cameraRoot: { flex: 1, backgroundColor: "#000" },
    ghost: { opacity: 0.4 },
    cameraBar: {
      position: "absolute",
      bottom: 36,
      left: 20,
      right: 20,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    cameraGhost: { color: "#fff", fontWeight: "700", width: 56 },
    shutter: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: "#fff",
      borderWidth: 6,
      borderColor: "#fb923c",
    },
    shutterDisabled: { opacity: 0.5 },
    flash: { ...StyleSheet.absoluteFillObject, backgroundColor: "#fff" },
    cameraTopBar: { position: "absolute", top: 56, left: 20, right: 20, alignItems: "center" },
    cameraCount: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 13,
      backgroundColor: "rgba(15,23,42,0.65)",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      overflow: "hidden",
    },
  });
}
