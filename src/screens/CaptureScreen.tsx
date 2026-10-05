import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { NauticalBackground } from "../components/NauticalBackground";
import { OnDeviceModelPanel } from "../components/OnDeviceModelPanel";
import { ShipAreaPicker } from "../components/ShipAreaPicker";
import { ThemeToggle } from "../components/ThemeToggle";
import { LiveInspectScreen } from "./LiveInspectScreen";
import { getLatestForRegion, type RegionHistory } from "../lib/api";
import { enqueuePart, saveQueuedPartPhotoEdits } from "../lib/offlineQueue";
import { CORROSION_CLASS_NAMES, runOnDeviceInspection } from "../lib/onDeviceInference";
import { canRunInference } from "../lib/session";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import { partLabel, type CaptureExtras, type InspectResults, type KnownSpot, type LocalPhoto, type VisionSession } from "../types";

function photoFromAsset(asset: ImagePicker.ImagePickerAsset, index: number): LocalPhoto {
  const uri = asset.uri;
  const mimeType = asset.mimeType || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const fileName = asset.fileName || `photo_${Date.now()}_${index}.${ext}`;
  return { uri, fileName, mimeType };
}

export function CaptureScreen({
  session,
  projectName,
  surveyName,
  initialRegionName,
  appendTargetId,
  editQueuedPart,
  onBack,
  onUpload,
  onOnDeviceInspect,
  onAppendInspect,
  onSavedQueuedPartEdits,
  onResurvey,
}: {
  session: VisionSession;
  projectName: string;
  surveyName: string;
  initialRegionName?: string;
  /** When set, this screen is adding a missed photo to an ALREADY-SURVEYED
   * part's job instead of starting a new one — no region picker, no raw
   * server-upload option, and results go to `onAppendInspect` instead. */
  appendTargetId?: string;
  /** When set, this screen is editing a STILL-QUEUED (not yet synced) part
   * in place — add/remove photos, save back to the SAME pending entry
   * instead of creating a new one. */
  editQueuedPart?: { id: string; initialPhotos: LocalPhoto[] };
  onBack: () => void;
  onUpload: (regionName: string, photos: LocalPhoto[], extras: CaptureExtras) => Promise<void>;
  onOnDeviceInspect: (results: InspectResults) => void;
  onAppendInspect?: (results: InspectResults) => void;
  onSavedQueuedPartEdits?: () => void;
  /** Offers "resurvey instead?" when the typed region name was already
   * surveyed before, in a different survey. */
  onResurvey?: (baselineInferenceId: string, area: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [regionName, setRegionName] = useState(initialRegionName || "");
  const [photos, setPhotos] = useState<LocalPhoto[]>(editQueuedPart?.initialPhotos ?? []);
  const [showCamera, setShowCamera] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [inspectingOnDevice, setInspectingOnDevice] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const [componentName, setComponentName] = useState("");
  const [notes, setNotes] = useState("");
  const [resurveySuggestion, setResurveySuggestion] = useState<RegionHistory["job"]>(null);
  const [knownSpots, setKnownSpots] = useState<KnownSpot[]>([]);
  const [matchedSpot, setMatchedSpot] = useState<KnownSpot | null>(null);
  const [dismissedSuggestionFor, setDismissedSuggestionFor] = useState<string | null>(null);

  // Only offered when starting a brand-new part (not append/edit), before any
  // photos are taken, and not for the region the user already dismissed.
  const canPickSpot = !appendTargetId && !editQueuedPart;
  const canSuggestResurvey = canPickSpot && !!onResurvey && photos.length === 0;

  // While naming a part: look up the spots already known in this area (offered
  // as quick picks), whether this exact area + component was captured before,
  // and its most recent earlier visit (for the "resurvey instead?" suggestion).
  useEffect(() => {
    const name = regionName.trim();
    if (!canPickSpot || name.length < 2) {
      setResurveySuggestion(null);
      setKnownSpots([]);
      setMatchedSpot(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await getLatestForRegion(session, projectName, name, componentName, surveyName);
        if (cancelled) return;
        setResurveySuggestion(res.job);
        setKnownSpots(res.observations);
        setMatchedSpot(res.observation);
      } catch {
        if (!cancelled) {
          setResurveySuggestion(null);
          setKnownSpots([]);
          setMatchedSpot(null);
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionName, componentName, canPickSpot, session, projectName, surveyName]);

  const addPhotos = (incoming: LocalPhoto[]) => {
    setPhotos((prev) => {
      const names = new Set(prev.map((p) => p.fileName));
      const extra = incoming.filter((p) => !names.has(p.fileName));
      return [...prev, ...extra];
    });
  };

  const pickGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    addPhotos(result.assets.map((asset, i) => photoFromAsset(asset, i)));
  };

  const openCamera = async () => {
    const current = permission?.granted ? permission : await requestPermission();
    if (!current.granted) {
      Alert.alert("Camera permission", "Allow camera access to take photos of the equipment.");
      return;
    }
    setShowCamera(true);
  };

  const snap = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (shot?.uri) {
        addPhotos([
          {
            uri: shot.uri,
            fileName: `camera_${Date.now()}.jpg`,
            mimeType: "image/jpeg",
          },
        ]);
        flashOpacity.setValue(0.85);
        Animated.timing(flashOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start();
      }
    } finally {
      setCapturing(false);
    }
  };

  const upload = async () => {
    if (!canRunInference(session.role)) {
      Alert.alert("No permission", "Your role cannot run inference. Ask a workspace admin.");
      return;
    }
    const name = regionName.trim();
    if (!name || photos.length === 0) return;
    setUploading(true);
    try {
      await onUpload(name, photos, { componentName: componentName.trim(), notes: notes.trim() });
    } catch (err) {
      // A network-looking failure (no signal) — save the part on-device instead
      // of losing it, so it can upload automatically once back online.
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
          regionName: name,
          photos,
          componentName: componentName.trim(),
          notes: notes.trim(),
        });
        Alert.alert(
          "Saved offline",
          `${photos.length} photo(s) for "${name}" are queued. They'll upload automatically next time you're online.`
        );
        onBack();
      } catch {
        Alert.alert("Upload failed", "No signal, and the photos could not be saved on-device either.");
      }
    } finally {
      setUploading(false);
    }
  };

  // Runs the corrosion model directly on the phone — no server, no network,
  // across every captured photo. This is a quick preview, not yet saved to
  // the survey; the results screen's "Confirm & add to survey" button
  // uploads these same photos for real server inference when the user
  // decides to keep it.
  const inspectOnDevice = async () => {
    const name = regionName.trim();
    if (!name || photos.length === 0) return;
    setInspectingOnDevice(true);
    try {
      const batch = await runOnDeviceInspection(photos);
      const results: InspectResults = {
        inferenceId: `ondevice_${Date.now()}`,
        regionName: name,
        surveyName,
        images: batch.images,
        batch: {
          imageCount: photos.length,
          meanCorrosionPercent: batch.meanCorrosionPercent ?? undefined,
          byClass: batch.byClass,
          classNames: [...CORROSION_CLASS_NAMES],
        },
        classNames: [...CORROSION_CLASS_NAMES],
        componentName: componentName.trim(),
        notes: notes.trim(),
      };
      if (appendTargetId) {
        onAppendInspect?.(results);
      } else {
        onOnDeviceInspect(results);
      }
    } catch (err) {
      Alert.alert("On-device inspect failed", err instanceof Error ? err.message : String(err));
    } finally {
      setInspectingOnDevice(false);
    }
  };

  // Applies the add/remove diff against the SAME still-queued part instead
  // of creating a new one — for "I forgot a photo" / "this one's bad" while
  // the part hasn't even reached the server yet.
  const saveQueuedEdits = async () => {
    if (!editQueuedPart || photos.length === 0) return;
    setSavingEdits(true);
    try {
      await saveQueuedPartPhotoEdits(editQueuedPart.id, editQueuedPart.initialPhotos, photos);
      onSavedQueuedPartEdits?.();
      onBack();
    } catch (err) {
      Alert.alert("Could not save changes", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSavingEdits(false);
    }
  };

  if (showLive) {
    return (
      <LiveInspectScreen
        session={session}
        projectName={projectName}
        onCapture={(photo) => {
          addPhotos([photo]);
          setShowLive(false);
        }}
        onClose={() => setShowLive(false)}
      />
    );
  }

  if (showCamera) {
    const lastPhoto = photos[photos.length - 1];
    return (
      <View style={styles.cameraRoot}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flashOpacity }]} />
        <View style={styles.cameraTopBar}>
          <Text style={styles.cameraCount}>
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </Text>
        </View>
        {lastPhoto ? (
          <View style={styles.lastShotWrap}>
            <Image source={{ uri: lastPhoto.uri }} style={styles.lastShot} />
          </View>
        ) : null}
        <View style={styles.cameraBar}>
          <Pressable onPress={() => setShowCamera(false)}>
            <Text style={styles.cameraGhost}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.shutter, capturing && styles.shutterDisabled]}
            onPress={snap}
            disabled={capturing}
          />
          <Pressable onPress={() => setShowCamera(false)} style={styles.doneBtn}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const canUpload = regionName.trim().length > 0 && photos.length > 0 && !uploading;
  const canInspectOnDevice =
    regionName.trim().length > 0 && photos.length > 0 && !uploading && !inspectingOnDevice;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <NauticalBackground
        icons={[
          { name: "compass-outline", size: 200, opacity: 0.12, style: { top: -30, right: -40, transform: [{ rotate: "8deg" }] } },
          { name: "ship-wheel", size: 120, opacity: 0.12, style: { bottom: 60, left: -35, transform: [{ rotate: "-14deg" }] } },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color={colors.accentText} />
          <Text style={styles.link}>Survey</Text>
        </Pressable>
        <View style={styles.headerRight}>
          <Text style={styles.project} numberOfLines={1}>
            {surveyName}
          </Text>
          <OnDeviceModelPanel session={session} projectName={projectName} />
          <ThemeToggle />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.titleRow}>
          <Ionicons
            name={editQueuedPart ? "create-outline" : appendTargetId ? "add-circle-outline" : "construct-outline"}
            size={22}
            color={colors.accentText}
          />
          <Text style={styles.title}>
            {editQueuedPart ? "Edit pending photos" : appendTargetId ? "Add a missed photo" : "Inspect a part"}
          </Text>
        </View>
        <Text style={styles.hint}>
          {editQueuedPart
            ? `This part hasn't been sent yet — add or remove photos and it stays as one pending "${regionName}" entry.`
            : appendTargetId
              ? `These photo(s) will be added to the existing "${regionName}" survey — not a new visit.`
              : `Walk to one area of the ship, name it (for example Cargo hold 3 starboard), then upload photos.`}
        </Text>

        <Text style={styles.label}>Ship part</Text>
        {editQueuedPart || appendTargetId ? (
          <Text style={styles.lockedRegionName}>{regionName}</Text>
        ) : (
          <ShipAreaPicker value={regionName} onChangeText={setRegionName} placeholder="Cargo hold 3 starboard" />
        )}

        {canPickSpot ? (
          <>
            <Text style={[styles.label, { marginTop: 14 }]}>Component / spot (optional)</Text>
            <TextInput
              value={componentName}
              onChangeText={setComponentName}
              placeholder="e.g. Fuel pump, Port hatch coaming"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            {knownSpots.some((k) => k.componentName) ? (
              <View style={styles.spotChips}>
                {knownSpots
                  .filter((k) => k.componentName)
                  .map((k) => {
                    const active = k.componentName.trim().toLowerCase() === componentName.trim().toLowerCase();
                    return (
                      <Pressable
                        key={k.observationId}
                        style={[styles.spotChip, active && styles.spotChipActive]}
                        onPress={() => setComponentName(active ? "" : k.componentName)}
                      >
                        <Text style={[styles.spotChipText, active && styles.spotChipTextActive]}>{k.componentName}</Text>
                      </Pressable>
                    );
                  })}
              </View>
            ) : null}
            {regionName.trim().length >= 2 ? (
              <Text style={styles.spotHint}>
                {matchedSpot
                  ? `Known spot ${matchedSpot.observationId} — this inspection is added to its history.`
                  : "New spot — it gets an ID (OBS-…) automatically once uploaded."}
              </Text>
            ) : null}
          </>
        ) : null}

        {resurveySuggestion && dismissedSuggestionFor !== resurveySuggestion.inferenceId ? (
          <View style={styles.resurveyBanner}>
            <Text style={styles.resurveyBannerText}>
              {resurveySuggestion.observationId ? `${resurveySuggestion.observationId} · ` : ""}"
              {partLabel({ regionName: regionName.trim(), componentName })}" was last surveyed in "{resurveySuggestion.surveyName}" on{" "}
              {new Date(resurveySuggestion.createdAt).toLocaleDateString()}.
            </Text>
            <View style={styles.resurveyBannerActions}>
              <Pressable onPress={() => setDismissedSuggestionFor(resurveySuggestion.inferenceId)}>
                <Text style={styles.resurveyBannerDismiss}>Not now</Text>
              </Pressable>
              <Pressable
                style={styles.resurveyBannerBtn}
                onPress={() => onResurvey?.(resurveySuggestion.inferenceId, regionName.trim())}
              >
                <Ionicons name="repeat" size={14} color="#fff" />
                <Text style={styles.resurveyBannerBtnText}>Resurvey instead?</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.rowBtns}>
          <Pressable style={styles.secondary} onPress={openCamera}>
            <Ionicons name="camera" size={18} color={colors.textPrimary} />
            <Text style={styles.secondaryText}>Camera</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={pickGallery}>
            <Ionicons name="images" size={18} color={colors.textPrimary} />
            <Text style={styles.secondaryText}>Gallery</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setShowLive(true)}>
            <Ionicons name="scan" size={18} color={colors.textPrimary} />
            <Text style={styles.secondaryText}>Live scan</Text>
          </Pressable>
        </View>

        <Text style={styles.count}>{photos.length} photo(s)</Text>
        <View style={styles.thumbs}>
          {photos.map((p) => (
            <View key={p.uri} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Pressable
                style={styles.remove}
                onPress={() => setPhotos((prev) => prev.filter((x) => x.uri !== p.uri))}
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {canPickSpot ? (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth recording, e.g. pitting near the weld"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.notesInput]}
              multiline
            />
          </>
        ) : null}

        {editQueuedPart ? (
          <>
            <Pressable
              style={[styles.primary, (savingEdits || photos.length === 0) && styles.disabled]}
              onPress={saveQueuedEdits}
              disabled={savingEdits || photos.length === 0}
            >
              {savingEdits ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color="#fff" />
                  <Text style={styles.primaryText}>Save changes</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.onDeviceHint}>
              Saved locally — this still uploads the normal way once you're online, with the updated photo set.
            </Text>
          </>
        ) : (
          <>
            {appendTargetId ? null : (
              <Pressable style={[styles.primary, !canUpload && styles.disabled]} onPress={upload} disabled={!canUpload}>
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={styles.primaryText}>Upload & inspect</Text>
                  </>
                )}
              </Pressable>
            )}

            <Pressable
              style={[
                appendTargetId ? styles.primary : styles.secondaryAction,
                !canInspectOnDevice && styles.disabled,
              ]}
              onPress={inspectOnDevice}
              disabled={!canInspectOnDevice}
            >
              {inspectingOnDevice ? (
                <ActivityIndicator color={appendTargetId ? "#fff" : colors.textPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="hardware-chip-outline"
                    size={18}
                    color={appendTargetId ? "#fff" : colors.textPrimary}
                  />
                  <Text style={appendTargetId ? styles.primaryText : styles.secondaryActionText}>
                    {appendTargetId ? "Add to survey" : "Inspect on-device"}
                  </Text>
                </>
              )}
            </Pressable>
            <Text style={styles.onDeviceHint}>
              {appendTargetId
                ? "Runs the model on this phone, no signal needed, then adds these photo(s) straight to the existing survey entry."
                : "Runs the model on this phone, no signal needed — a quick preview. On the results screen you can confirm to upload it as a real survey part."}
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 52 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  linkRow: { flexDirection: "row", alignItems: "center" },
  link: { color: colors.accentText, fontWeight: "600" },
  project: { color: colors.textSecondary, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: "700" },
  hint: { color: colors.textSecondary, marginTop: 8, marginBottom: 16, lineHeight: 20 },
  label: { color: colors.textSecondary, marginBottom: 6 },
  lockedRegionName: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 10,
    color: colors.textPrimary,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 10,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  resurveyBanner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  resurveyBannerText: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  resurveyBannerActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 14, marginTop: 10 },
  resurveyBannerDismiss: { color: colors.textSecondary, fontWeight: "600", fontSize: 13 },
  resurveyBannerBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  resurveyBannerBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  notesInput: { minHeight: 70, textAlignVertical: "top" },
  spotChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  spotChip: {
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  spotChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  spotChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  spotChipTextActive: { color: "#fff" },
  spotHint: { color: colors.textMuted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  rowBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
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
  count: { color: colors.textMuted, marginTop: 16, marginBottom: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  primary: {
    backgroundColor: colors.accent,
    marginTop: 24,
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
    marginTop: 14,
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
  onDeviceHint: { color: colors.textMuted, fontSize: 12, marginTop: 8, lineHeight: 17, textAlign: "center" },
  // Camera viewfinder is intentionally always dark regardless of app theme
  // (matches standard camera-app UX, not "app content").
  cameraRoot: { flex: 1, backgroundColor: "#000" },
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
  doneBtn: { minWidth: 56, alignItems: "flex-end" },
  doneText: { color: "#fb923c", fontWeight: "700", fontSize: 15 },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
  },
  cameraTopBar: {
    position: "absolute",
    top: 56,
    left: 20,
    right: 20,
    alignItems: "center",
  },
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
  lastShotWrap: {
    position: "absolute",
    bottom: 132,
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fb923c",
  },
  lastShot: { width: "100%", height: "100%" },
  });
}
