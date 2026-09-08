import { Directory, File, Paths } from "expo-file-system";
import { Asset } from "expo-asset";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiUrl } from "./config";
import { authHeaderRecord } from "./session";
import type { VisionSession } from "../types";

/**
 * Lets a crew member swap the on-device corrosion model without an app
 * rebuild: download whatever's pinned for a project in Workspace Settings
 * (web app), or import a .tflite file already on the phone. Falls back to
 * the model bundled in the app binary when no custom model is active.
 */

const MODEL_DIR = new Directory(Paths.document, "models");
const CUSTOM_MODEL_FILENAME = "custom-model.tflite";
const META_KEY = "visionm.ondevice.customModel.meta.v1";

export type TfliteVariant = "float16" | "float32";
export type CustomModelSource = "server" | "file";

export type CustomModelMeta = {
  source: CustomModelSource;
  label: string;
  fileSize: number;
  downloadedAt: string;
  modelId?: string;
  modelVersion?: string;
  variant?: TfliteVariant;
  company?: string;
  project?: string;
};

function customModelFile(): File {
  return new File(MODEL_DIR, CUSTOM_MODEL_FILENAME);
}

/** Returns the active custom model's metadata, or null if none is set (or its file went missing). */
export async function getCustomModelMeta(): Promise<CustomModelMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as CustomModelMeta;
    if (!customModelFile().exists) return null;
    return meta;
  } catch {
    return null;
  }
}

/** Resolves the .tflite the app should run on-device inference with right now. */
export async function getActiveModelUri(): Promise<{ uri: string; meta: CustomModelMeta | null }> {
  const meta = await getCustomModelMeta();
  if (meta) {
    return { uri: customModelFile().uri, meta };
  }
  // require() alone hit a native asset-resolution bug on Android for this
  // large binary — resolving to a real file:// path via expo-asset sidesteps it.
  const asset = Asset.fromModule(require("../../assets/models/corrosion-bike-rust-v2.tflite"));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("Could not resolve the bundled model's local path");
  return { uri: asset.localUri, meta: null };
}

async function saveMeta(meta: CustomModelMeta): Promise<void> {
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

/**
 * Downloads whichever YOLO_SEG model is pinned for this project (Workspace
 * Settings on the web app) and switches on-device inspection to use it.
 * If the server hasn't converted this model to TFLite before, this can take
 * a few minutes — the backend converts on demand, then caches it.
 */
export async function downloadPinnedModel(
  session: VisionSession,
  projectName: string,
  variant: TfliteVariant = "float16"
): Promise<CustomModelMeta> {
  const headers = authHeaderRecord(session, true);

  const qs = new URLSearchParams({ company: session.companyName, project: projectName });
  const configRes = await fetch(apiUrl(`/mobile-inspect/config?${qs.toString()}`), { headers });
  if (!configRes.ok) {
    throw new Error(`Could not check the pinned model (HTTP ${configRes.status})`);
  }
  const configJson = await configRes.json();
  const config = configJson.config;
  if (!config?.modelId) {
    throw new Error(
      configJson.message ||
        "No model is pinned for this project. Pin a YOLO_SEG model in Workspace Settings on the web app."
    );
  }

  MODEL_DIR.create({ intermediates: true, idempotent: true });

  const downloadUrl = apiUrl(
    `/models/${encodeURIComponent(config.modelId)}/download?format=tflite&variant=${variant}`
  );
  const target = customModelFile();
  await File.downloadFileAsync(downloadUrl, target, { headers, idempotent: true });

  const meta: CustomModelMeta = {
    source: "server",
    label: `${config.modelVersion || config.modelId} (${variant})`,
    fileSize: target.size,
    downloadedAt: new Date().toISOString(),
    modelId: config.modelId,
    modelVersion: config.modelVersion,
    variant,
    company: session.companyName,
    project: projectName,
  };
  await saveMeta(meta);
  return meta;
}

/** Lets the user import a .tflite file already on the device (e.g. saved from the web app). */
export async function importModelFile(): Promise<CustomModelMeta> {
  const picked = await File.pickFileAsync();
  const file = Array.isArray(picked) ? picked[0] : picked;
  if (!file) {
    throw new Error("No file selected");
  }
  // pickFileAsync's declared return type is the base file class, which
  // doesn't carry the wrapper's `.name` getter — derive it from the uri instead.
  const fileName = decodeURIComponent(file.uri.split("/").pop() || "model.tflite");
  if (!fileName.toLowerCase().endsWith(".tflite")) {
    throw new Error("Please select a .tflite file.");
  }

  MODEL_DIR.create({ intermediates: true, idempotent: true });
  const target = customModelFile();
  if (target.exists) target.delete();
  file.copy(target);

  const meta: CustomModelMeta = {
    source: "file",
    label: fileName,
    fileSize: target.size,
    downloadedAt: new Date().toISOString(),
  };
  await saveMeta(meta);
  return meta;
}

/** Drops the custom model and goes back to the one bundled in the app binary. */
export async function resetToDefaultModel(): Promise<void> {
  await AsyncStorage.removeItem(META_KEY);
  const target = customModelFile();
  if (target.exists) target.delete();
}
