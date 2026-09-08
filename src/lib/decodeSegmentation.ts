/**
 * Decodes raw YOLOv8-seg output tensors into actual detections with pixel
 * masks. Pure math, no native/Skia dependencies, so the logic here can be
 * reasoned about (and unit-tested) independent of rendering.
 *
 * Model specifics (bike_rust_model_2, verified against the real exported
 * .tflite via Python's tf.lite.Interpreter — see onDeviceInference.ts):
 *   - predictions: [1, 39, 8400] — 39 = 4 box coords + 3 class scores + 32 mask coeffs,
 *     laid out channel-first: predictions[attr * 8400 + anchor]
 *   - maskProtos: [1, 160, 160, 32] — NHWC: maskProtos[(y*160+x)*32 + c]
 *   - box coords (cx, cy, w, h) are in the model's 640x640 input pixel space
 */

export const MODEL_SIZE = 640;
export const PROTO_SIZE = 160;
export const NUM_ANCHORS = 8400;
export const NUM_MASK_COEFFS = 32;

export type Detection = {
  classId: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coeffs: Float32Array;
};

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Parses raw predictions into candidate boxes above the confidence threshold. */
function parseCandidates(
  predictions: Float32Array,
  numClasses: number,
  confidenceThreshold: number
): Detection[] {
  const candidates: Detection[] = [];
  for (let a = 0; a < NUM_ANCHORS; a++) {
    let bestClass = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const score = predictions[(4 + c) * NUM_ANCHORS + a];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < confidenceThreshold) continue;

    // Box coords come out normalized 0-1, not pixel space — verified against
    // the actual raw TFLite output (a plain 0-640 assumption silently
    // collapsed every box to ~1x1px). Scale to the model's 640x640 input.
    const cx = predictions[0 * NUM_ANCHORS + a] * MODEL_SIZE;
    const cy = predictions[1 * NUM_ANCHORS + a] * MODEL_SIZE;
    const w = predictions[2 * NUM_ANCHORS + a] * MODEL_SIZE;
    const h = predictions[3 * NUM_ANCHORS + a] * MODEL_SIZE;

    const coeffs = new Float32Array(NUM_MASK_COEFFS);
    for (let i = 0; i < NUM_MASK_COEFFS; i++) {
      coeffs[i] = predictions[(4 + numClasses + i) * NUM_ANCHORS + a];
    }

    candidates.push({
      classId: bestClass,
      confidence: bestScore,
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2,
      coeffs,
    });
  }
  return candidates;
}

/** Greedy per-class non-max suppression. */
function nonMaxSuppression(candidates: Detection[], iouThreshold: number): Detection[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const candidate of sorted) {
    const overlapsKept = kept.some(
      (k) => k.classId === candidate.classId && iou(k, candidate) > iouThreshold
    );
    if (!overlapsKept) kept.push(candidate);
  }
  return kept;
}

export function detectObjects(
  predictions: Float32Array,
  numClasses: number,
  confidenceThreshold = 0.2,
  iouThreshold = 0.45
): Detection[] {
  const candidates = parseCandidates(predictions, numClasses, confidenceThreshold);
  return nonMaxSuppression(candidates, iouThreshold);
}

/**
 * Combines a detection's mask coefficients with the prototype tensor,
 * upsamples to model resolution, and crops/thresholds to the detection's box.
 * Returns a MODEL_SIZE x MODEL_SIZE boolean mask (1 = pixel belongs to this
 * detection), values outside the box are always 0.
 */
export function decodeDetectionMask(detection: Detection, maskProtos: Float32Array): Uint8Array {
  const proto = new Float32Array(PROTO_SIZE * PROTO_SIZE);
  for (let y = 0; y < PROTO_SIZE; y++) {
    for (let x = 0; x < PROTO_SIZE; x++) {
      const base = (y * PROTO_SIZE + x) * NUM_MASK_COEFFS;
      let sum = 0;
      for (let c = 0; c < NUM_MASK_COEFFS; c++) {
        sum += detection.coeffs[c] * maskProtos[base + c];
      }
      proto[y * PROTO_SIZE + x] = 1 / (1 + Math.exp(-sum));
    }
  }

  const scale = MODEL_SIZE / PROTO_SIZE; // 4
  const bx1 = Math.max(0, Math.floor(detection.x1));
  const by1 = Math.max(0, Math.floor(detection.y1));
  const bx2 = Math.min(MODEL_SIZE, Math.ceil(detection.x2));
  const by2 = Math.min(MODEL_SIZE, Math.ceil(detection.y2));

  const mask = new Uint8Array(MODEL_SIZE * MODEL_SIZE);
  for (let y = by1; y < by2; y++) {
    const protoY = Math.min(PROTO_SIZE - 1, Math.floor(y / scale));
    for (let x = bx1; x < bx2; x++) {
      const protoX = Math.min(PROTO_SIZE - 1, Math.floor(x / scale));
      if (proto[protoY * PROTO_SIZE + protoX] > 0.5) {
        mask[y * MODEL_SIZE + x] = 1;
      }
    }
  }
  return mask;
}
