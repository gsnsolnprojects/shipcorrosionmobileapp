import { useRef, useState } from "react";
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
import { PIXEL_DISCLAIMER } from "../lib/config";
import { enqueuePart } from "../lib/offlineQueue";
import { canRunInference } from "../lib/session";
import type { LocalPhoto, VisionSession } from "../types";

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
  onBack,
  onUpload,
}: {
  session: VisionSession;
  projectName: string;
  surveyName: string;
  onBack: () => void;
  onUpload: (regionName: string, photos: LocalPhoto[]) => Promise<void>;
}) {
  const [regionName, setRegionName] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const flashOpacity = useRef(new Animated.Value(0)).current;

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
      await onUpload(name, photos);
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

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.linkRow}>
          <Ionicons name="chevron-back" size={18} color="#fb923c" />
          <Text style={styles.link}>Survey</Text>
        </Pressable>
        <Text style={styles.project} numberOfLines={1}>
          {surveyName}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.title}>Inspect a part</Text>
        <Text style={styles.hint}>
          Walk to one area of the ship, name it (for example Cargo hold 3 starboard), then upload photos. {PIXEL_DISCLAIMER}
        </Text>

        <Text style={styles.label}>Ship part</Text>
        <TextInput
          style={styles.input}
          value={regionName}
          onChangeText={setRegionName}
          placeholder="Cargo hold 3 starboard"
          placeholderTextColor="#64748b"
        />

        <View style={styles.rowBtns}>
          <Pressable style={styles.secondary} onPress={openCamera}>
            <Ionicons name="camera" size={18} color="#e2e8f0" />
            <Text style={styles.secondaryText}>Camera</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={pickGallery}>
            <Ionicons name="images" size={18} color="#e2e8f0" />
            <Text style={styles.secondaryText}>Gallery</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 52 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  linkRow: { flexDirection: "row", alignItems: "center" },
  link: { color: "#fb923c", fontWeight: "600" },
  project: { color: "#94a3b8", fontWeight: "600" },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "700" },
  hint: { color: "#94a3b8", marginTop: 8, marginBottom: 16, lineHeight: 20 },
  label: { color: "#cbd5e1", marginBottom: 6 },
  input: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: { color: "#e2e8f0", fontWeight: "600" },
  count: { color: "#64748b", marginTop: 16, marginBottom: 8 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { width: 96, height: 96 },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: "#1e293b" },
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
    backgroundColor: "#ea580c",
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
