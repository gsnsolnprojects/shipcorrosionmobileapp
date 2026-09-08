import { AlphaType, ColorType, ImageFormat, Skia } from "@shopify/react-native-skia";
import { loadTensorflowModel, type TensorflowModel } from "react-native-fast-tflite";
import { CLASS_MASK_COLORS } from "./classColors";
import { decodeDetectionMask, detectObjects, MODEL_SIZE } from "./decodeSegmentation";
import { getActiveModelUri } from "./modelManager";
import type { CorrosionByClass, LocalPhoto, ResultImage } from "../types";

/**
 * Runs the corrosion YOLOv8-seg model directly on the phone, no network needed.
 *
 * Model input: [1, 640, 640, 3] float32, RGB, normalized 0-1 (verified against
 * the actual exported .tflite via Python's tf.lite.Interpreter, not assumed).
 * Model outputs:
 *   - predictions: [1, 39, 8400] — per-anchor (4 box coords + 3 class scores + 32 mask coefficients).
 *     Box coords are normalized 0-1, not pixel space (verified against raw output).
 *   - maskProtos: [1, 160, 160, 32] — mask prototypes, NHWC
 * Classes: 0=high_rust, 1=med_rust, 2=low_rust (bike_rust_model_2, matches production).
 */

export const CORROSION_CLASS_NAMES = ["high_rust", "med_rust", "low_rust"] as const;
const OVERLAY_ALPHA = 0.45;
const CONFIDENCE_THRESHOLD = 0.2; // matches the production server's pinned threshold

let modelPromise: Promise<TensorflowModel> | null = null;

async function loadModel(): Promise<TensorflowModel> {
  const { uri } = await getActiveModelUri();
  return loadTensorflowModel({ url: uri }, []);
}

function getModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = loadModel();
  }
  return modelPromise;
}

/** Call after switching the active on-device model so the next inspect reloads it. */
export function invalidateModelCache(): void {
  modelPromise = null;
}

/** Decodes a photo URI and resizes it to the model's expected 640x640 input. */
async function decodePhoto(photoUri: string): Promise<{ input: Float32Array; basePixels: Uint8Array }> {
  const data = await Skia.Data.fromURI(photoUri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error("Could not decode photo for on-device inference");

  const surface = Skia.Surface.Make(MODEL_SIZE, MODEL_SIZE);
  if (!surface) throw new Error("Could not allocate decode surface");

  const canvas = surface.getCanvas();
  const src = Skia.XYWHRect(0, 0, image.width(), image.height());
  const dest = Skia.XYWHRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  canvas.drawImageRect(image, src, dest, Skia.Paint());

  const resized = surface.makeImageSnapshot();
  const pixels = resized.readPixels(0, 0, {
    width: MODEL_SIZE,
    height: MODEL_SIZE,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Could not read decoded pixels");

  // Model wants NHWC float32 RGB in [0, 1] — drop the alpha channel Skia gives us.
  const input = new Float32Array(MODEL_SIZE * MODEL_SIZE * 3);
  for (let src4 = 0, dst3 = 0; src4 < pixels.length; src4 += 4, dst3 += 3) {
    input[dst3] = pixels[src4] / 255;
    input[dst3 + 1] = pixels[src4 + 1] / 255;
    input[dst3 + 2] = pixels[src4 + 2] / 255;
  }
  return { input, basePixels: pixels };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type SinglePhotoResult = {
  imageUri: string;
  totalCorrosionPercent: number;
  byClass: CorrosionByClass[];
};

async function inspectOnePhoto(photoUri: string): Promise<SinglePhotoResult> {
  const model = await getModel();
  const { input, basePixels } = await decodePhoto(photoUri);
  const outputs = await model.run([input.buffer as ArrayBuffer]);
  const predictions = new Float32Array(outputs[0]);
  const maskProtos = new Float32Array(outputs[1]);

  const detections = detectObjects(predictions, CORROSION_CLASS_NAMES.length, CONFIDENCE_THRESHOLD);

  // -1 = no detection at that pixel; otherwise the winning class id.
  const winningClass = new Int8Array(MODEL_SIZE * MODEL_SIZE).fill(-1);
  for (const detection of detections) {
    const mask = decodeDetectionMask(detection, maskProtos);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) winningClass[i] = detection.classId;
    }
  }

  const counts = new Array(CORROSION_CLASS_NAMES.length).fill(0);
  const blended = new Uint8Array(basePixels.length);
  blended.set(basePixels);
  for (let i = 0; i < winningClass.length; i++) {
    const classId = winningClass[i];
    if (classId < 0) continue;
    counts[classId]++;
    const [r, g, b] = hexToRgb(CLASS_MASK_COLORS[classId % CLASS_MASK_COLORS.length]);
    const px = i * 4;
    blended[px] = Math.round(blended[px] * (1 - OVERLAY_ALPHA) + r * OVERLAY_ALPHA);
    blended[px + 1] = Math.round(blended[px + 1] * (1 - OVERLAY_ALPHA) + g * OVERLAY_ALPHA);
    blended[px + 2] = Math.round(blended[px + 2] * (1 - OVERLAY_ALPHA) + b * OVERLAY_ALPHA);
  }

  const finalData = Skia.Data.fromBytes(blended);
  const finalImage = Skia.Image.MakeImage(
    { width: MODEL_SIZE, height: MODEL_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    finalData,
    MODEL_SIZE * 4
  );
  if (!finalImage) throw new Error("Could not composite the result overlay");
  const base64 = finalImage.encodeToBase64(ImageFormat.PNG);

  const totalPixels = MODEL_SIZE * MODEL_SIZE;
  const byClass: CorrosionByClass[] = CORROSION_CLASS_NAMES.map((name, classId) => ({
    class: name,
    classId,
    percent: (counts[classId] / totalPixels) * 100,
    count: detections.filter((d) => d.classId === classId).length,
  }));
  const totalCorrosionPercent = (counts.reduce((sum, c) => sum + c, 0) / totalPixels) * 100;

  return {
    imageUri: `data:image/png;base64,${base64}`,
    totalCorrosionPercent,
    byClass,
  };
}

export type OnDeviceBatchResult = {
  images: ResultImage[];
  meanCorrosionPercent: number | null;
  byClass: CorrosionByClass[];
};

/** Merges per-class stats across photos: average percent, sum instance count. */
function mergeByClass(perPhoto: CorrosionByClass[][]): CorrosionByClass[] {
  return CORROSION_CLASS_NAMES.map((name, classId) => {
    const rows = perPhoto.map((byClass) => byClass[classId]).filter(Boolean);
    const percentSum = rows.reduce((sum, r) => sum + (r.percent ?? 0), 0);
    const count = rows.reduce((sum, r) => sum + (r.count ?? 0), 0);
    return {
      class: name,
      classId,
      percent: rows.length ? percentSum / rows.length : 0,
      count,
    };
  });
}

/**
 * Runs on-device inspection across every captured photo and returns an
 * aggregate shaped exactly like a server InspectResults' `images`/`batch`
 * fields, so the existing ResultsScreen can render either source identically.
 */
export async function runOnDeviceInspection(photos: LocalPhoto[]): Promise<OnDeviceBatchResult> {
  const perPhoto: SinglePhotoResult[] = [];
  for (const photo of photos) {
    perPhoto.push(await inspectOnePhoto(photo.uri));
  }

  const images: ResultImage[] = perPhoto.map((r, i) => ({
    filename: photos[i].fileName,
    url: r.imageUri,
    corrosionPercentTotal: r.totalCorrosionPercent,
    byClass: r.byClass,
    instanceCount: r.byClass.reduce((sum, c) => sum + (c.count ?? 0), 0),
  }));

  const percents = perPhoto.map((r) => r.totalCorrosionPercent);
  const meanCorrosionPercent = percents.length
    ? percents.reduce((sum, n) => sum + n, 0) / percents.length
    : null;

  return {
    images,
    meanCorrosionPercent,
    byClass: mergeByClass(perPhoto.map((r) => r.byClass)),
  };
}
