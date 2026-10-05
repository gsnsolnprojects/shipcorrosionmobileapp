import { Directory, File, Paths } from "expo-file-system";
import { apiUrl } from "./config";
import { authHeaderRecord } from "./session";
import type { CaptureExtras, CorrosionByClass, InspectResults, ResultImage, VisionSession } from "../types";

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

function pngFilename(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") + ".png";
}

/** An on-device annotated image already written to a real file:// URI on disk. */
export type PrecomputedImage = {
  filename: string;
  uri: string;
  corrosionPercentTotal?: number;
  byClass: CorrosionByClass[];
  instanceCount?: number;
  /** Resurvey only — the baseline job's photo filename this one was shot to match. */
  matchedBaselineFilename?: string | null;
};

/** Decodes each on-device result image's base64 payload and writes it into `dir`. */
export function writeBase64ImagesToDir(dir: Directory, images: ResultImage[]): PrecomputedImage[] {
  return images.map((img) => {
    const filename = pngFilename(img.filename);
    const base64 = img.url.replace(/^data:image\/\w+;base64,/, "");
    const file = new File(dir, filename);
    file.write(base64, { encoding: "base64" });
    return {
      filename,
      uri: file.uri,
      corrosionPercentTotal: img.corrosionPercentTotal,
      byClass: img.byClass || [],
      instanceCount: img.instanceCount,
      matchedBaselineFilename: img.matchedBaselineFilename ?? null,
    };
  });
}

/**
 * Uploads already-annotated images (real file:// URIs) plus already-computed
 * stats as-is — the server does not re-run inference. Shared by the "live"
 * confirm flow (images just written to a temp dir) and by syncing a
 * previously offline-queued on-device result (images already persisted).
 */
export async function uploadPrecomputedResult(
  session: VisionSession,
  projectName: string,
  surveyName: string,
  regionName: string,
  images: PrecomputedImage[],
  classNames: string[],
  meanCorrosionPercent: number | null,
  byClass: CorrosionByClass[],
  baselineInferenceId?: string | null,
  extras?: CaptureExtras
): Promise<{ inferenceId: string }> {
  const form = new FormData();
  form.append("regionName", regionName);
  form.append("surveyName", surveyName);
  form.append("project", projectName);
  if (baselineInferenceId) form.append("baselineInferenceId", baselineInferenceId);
  if (extras?.componentName?.trim()) form.append("componentName", extras.componentName.trim());
  if (extras?.notes?.trim()) form.append("notes", extras.notes.trim());
  if (extras?.assessment) form.append("assessment", JSON.stringify(extras.assessment));

  for (const img of images) {
    form.append("files", { uri: img.uri, name: img.filename, type: "image/png" } as unknown as Blob);
  }

  form.append(
    "stats",
    JSON.stringify({
      classNames,
      meanCorrosionPercent,
      byClass,
      images: images.map((img) => ({
        filename: img.filename,
        corrosionPercentTotal: img.corrosionPercentTotal,
        byClass: img.byClass,
        instanceCount: img.instanceCount,
        matchedBaselineFilename: img.matchedBaselineFilename || undefined,
      })),
    })
  );

  const res = await fetch(apiUrl("/mobile-inspect/confirm-on-device"), {
    method: "POST",
    headers: authHeaderRecord(session, false),
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const json = await res.json();
  return { inferenceId: json.inferenceId };
}

/**
 * Appends already-annotated images + already-computed stats to an EXISTING
 * completed job, instead of creating a new one — for "I forgot a photo for
 * this part" rather than "this is a new visit." The server recomputes that
 * job's aggregate stats from the combined image set.
 */
export async function uploadImagesToExistingJob(
  session: VisionSession,
  inferenceId: string,
  images: PrecomputedImage[],
  classNames: string[]
): Promise<{ addedImages: number; totalImages: number }> {
  const form = new FormData();
  for (const img of images) {
    form.append("files", { uri: img.uri, name: img.filename, type: "image/png" } as unknown as Blob);
  }
  form.append(
    "stats",
    JSON.stringify({
      classNames,
      images: images.map((img) => ({
        filename: img.filename,
        corrosionPercentTotal: img.corrosionPercentTotal,
        byClass: img.byClass,
        instanceCount: img.instanceCount,
      })),
    })
  );

  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/images`), {
    method: "POST",
    headers: authHeaderRecord(session, false),
    body: form,
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const json = await res.json();
  return { addedImages: json.addedImages, totalImages: json.totalImages };
}

/**
 * Confirms an on-device preview into a real, permanent survey part. The
 * annotated images arrive as base64 data URLs (from Skia), so they're first
 * written to temp files the multipart upload can reference.
 */
export async function confirmOnDeviceResult(
  session: VisionSession,
  projectName: string,
  surveyName: string,
  regionName: string,
  results: InspectResults
): Promise<{ inferenceId: string }> {
  const tempDir = new Directory(Paths.cache, `confirm-on-device-${Date.now()}`);
  tempDir.create({ intermediates: true, idempotent: true });

  try {
    const images = writeBase64ImagesToDir(tempDir, results.images);
    return await uploadPrecomputedResult(
      session,
      projectName,
      surveyName,
      regionName,
      images,
      results.classNames || [],
      results.batch?.meanCorrosionPercent ?? null,
      results.batch?.byClass || [],
      results.baselineInferenceId,
      { componentName: results.componentName, notes: results.notes, assessment: results.assessment }
    );
  } finally {
    try {
      tempDir.delete();
    } catch {
      // Best-effort cleanup — Paths.cache is system-cleanable anyway.
    }
  }
}

/**
 * Appends an on-device preview to an ALREADY-EXISTING job's results — the
 * "I forgot a photo for this part" counterpart to `confirmOnDeviceResult`,
 * which always creates a new one. Same base64-to-temp-file bridging.
 */
export async function appendOnDeviceResult(
  session: VisionSession,
  inferenceId: string,
  results: InspectResults
): Promise<{ addedImages: number; totalImages: number }> {
  const tempDir = new Directory(Paths.cache, `append-on-device-${Date.now()}`);
  tempDir.create({ intermediates: true, idempotent: true });

  try {
    const images = writeBase64ImagesToDir(tempDir, results.images);
    return await uploadImagesToExistingJob(session, inferenceId, images, results.classNames || []);
  } finally {
    try {
      tempDir.delete();
    } catch {
      // Best-effort cleanup — Paths.cache is system-cleanable anyway.
    }
  }
}
