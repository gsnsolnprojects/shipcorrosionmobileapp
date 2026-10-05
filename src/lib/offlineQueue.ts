import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { confirmInferencePart, startInspect } from "./api";
import {
  uploadImagesToExistingJob,
  uploadPrecomputedResult,
  writeBase64ImagesToDir,
  type PrecomputedImage,
} from "./confirmOnDevice";
import { runOnDeviceInspection } from "./onDeviceInference";
import type { Assessment, CorrosionByClass, InspectResults, LocalPhoto, PhotoMatch, VisionSession } from "../types";

const QUEUE_KEY = "visionm.offlineQueue.v1";

export type QueuedUploadPart = {
  kind: "upload";
  id: string;
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  createdAt: string;
  photos: LocalPhoto[];
  /** Resurvey only — set together, both optional. */
  baselineInferenceId?: string | null;
  photoMatches?: PhotoMatch[];
  componentName?: string;
  notes?: string;
};

/** An on-device preview confirmed while offline — already-annotated images + stats, waiting to sync. */
export type QueuedOnDevicePart = {
  kind: "on_device";
  id: string;
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  createdAt: string;
  images: PrecomputedImage[];
  classNames: string[];
  meanCorrosionPercent: number | null;
  byClass: CorrosionByClass[];
  /** Resurvey only — per-image matches already live on each PrecomputedImage. */
  baselineInferenceId?: string | null;
  componentName?: string;
  notes?: string;
  assessment?: Assessment | null;
};

/** A missed photo added on-device to an ALREADY-EXISTING part, offline — appends to that job on sync, doesn't create a new visit. */
export type QueuedAppendPart = {
  kind: "append";
  id: string;
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  targetInferenceId: string;
  createdAt: string;
  images: PrecomputedImage[];
  classNames: string[];
};

export type QueuedPart = QueuedUploadPart | QueuedOnDevicePart | QueuedAppendPart;

function offlineDir(): Directory {
  const dir = new Directory(Paths.document, "offline-inspect");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Queue entries written before `kind` existed are always the upload (raw photos) kind. */
function normalizePart(raw: any): QueuedPart {
  if (raw?.kind === "on_device") return raw as QueuedOnDevicePart;
  if (raw?.kind === "append") return raw as QueuedAppendPart;
  return { ...raw, kind: "upload" } as QueuedUploadPart;
}

async function readQueue(): Promise<QueuedPart[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizePart) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedPart[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/**
 * Copies captured photos into the app's permanent document storage (survives
 * app restarts, unlike camera-roll/cache URIs) and saves the job metadata to
 * the on-device queue so it can be uploaded later once there's a signal.
 */
export async function enqueuePart(input: {
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  photos: LocalPhoto[];
  baselineInferenceId?: string | null;
  photoMatches?: PhotoMatch[];
  componentName?: string;
  notes?: string;
}): Promise<QueuedUploadPart> {
  const dir = offlineDir();
  const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const storedPhotos: LocalPhoto[] = input.photos.map((photo, index) => {
    const dest = new File(dir, `${id}_${index}_${safeName(photo.fileName)}`);
    new File(photo.uri).copy(dest);
    return { uri: dest.uri, fileName: photo.fileName, mimeType: photo.mimeType };
  });

  const part: QueuedUploadPart = {
    kind: "upload",
    id,
    companyId: input.companyId,
    companyName: input.companyName,
    projectName: input.projectName,
    surveyName: input.surveyName,
    regionName: input.regionName,
    createdAt: new Date().toISOString(),
    photos: storedPhotos,
    baselineInferenceId: input.baselineInferenceId ?? null,
    photoMatches: input.photoMatches,
    componentName: input.componentName || "",
    notes: input.notes || "",
  };

  const queue = await readQueue();
  queue.push(part);
  await writeQueue(queue);
  return part;
}

/**
 * Persists an on-device preview's already-annotated images + already-computed
 * stats to disk and queues it, for confirming into a real survey part later
 * once there's a signal — mirrors `enqueuePart`, but for the on-device path,
 * which has nothing to (re-)upload except the results already computed.
 */
export async function enqueueOnDeviceResult(input: {
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  results: InspectResults;
}): Promise<QueuedOnDevicePart> {
  const dir = offlineDir();
  const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const partDir = new Directory(dir, id);
  partDir.create({ intermediates: true, idempotent: true });

  const images = writeBase64ImagesToDir(partDir, input.results.images);

  const part: QueuedOnDevicePart = {
    kind: "on_device",
    id,
    companyId: input.companyId,
    companyName: input.companyName,
    projectName: input.projectName,
    surveyName: input.surveyName,
    regionName: input.regionName,
    createdAt: new Date().toISOString(),
    images,
    classNames: input.results.classNames || [],
    meanCorrosionPercent: input.results.batch?.meanCorrosionPercent ?? null,
    byClass: input.results.batch?.byClass || [],
    baselineInferenceId: input.results.baselineInferenceId ?? null,
    componentName: input.results.componentName || "",
    notes: input.results.notes || "",
    assessment: input.results.assessment ?? null,
  };

  const queue = await readQueue();
  queue.push(part);
  await writeQueue(queue);
  return part;
}

/**
 * Persists a missed photo's already-computed on-device results and queues
 * them to be appended to an EXISTING part's job once there's a signal —
 * mirrors `enqueueOnDeviceResult`, but targets a specific already-completed
 * inferenceId instead of creating a new job.
 */
export async function enqueueAppendResult(input: {
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  targetInferenceId: string;
  results: InspectResults;
}): Promise<QueuedAppendPart> {
  const dir = offlineDir();
  const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const partDir = new Directory(dir, id);
  partDir.create({ intermediates: true, idempotent: true });

  const images = writeBase64ImagesToDir(partDir, input.results.images);

  const part: QueuedAppendPart = {
    kind: "append",
    id,
    companyId: input.companyId,
    companyName: input.companyName,
    projectName: input.projectName,
    surveyName: input.surveyName,
    regionName: input.regionName,
    targetInferenceId: input.targetInferenceId,
    createdAt: new Date().toISOString(),
    images,
    classNames: input.results.classNames || [],
  };

  const queue = await readQueue();
  queue.push(part);
  await writeQueue(queue);
  return part;
}

/** Mirrors the backend's recomputeAggregatesFromImages, but for a queued on-device part's already-known per-image stats — pure arithmetic, no re-inference needed. */
function recomputeOnDeviceAggregate(images: PrecomputedImage[]): {
  meanCorrosionPercent: number | null;
  byClass: CorrosionByClass[];
} {
  const percents = images
    .map((img) => img.corrosionPercentTotal)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const meanCorrosionPercent = percents.length ? percents.reduce((sum, n) => sum + n, 0) / percents.length : null;

  const buckets = new Map<string, { class: string; classId?: number; percentSum: number; n: number; count: number }>();
  for (const img of images) {
    for (const row of img.byClass || []) {
      const key = String(row.classId ?? row.class);
      const bucket = buckets.get(key) || { class: row.class, classId: row.classId, percentSum: 0, n: 0, count: 0 };
      if (typeof row.percent === "number") {
        bucket.percentSum += row.percent;
        bucket.n += 1;
      }
      bucket.count += Number(row.count) || 0;
      buckets.set(key, bucket);
    }
  }
  const byClass: CorrosionByClass[] = Array.from(buckets.values()).map((b) => ({
    class: b.class,
    classId: b.classId,
    percent: b.n ? b.percentSum / b.n : 0,
    count: b.count,
  }));

  return { meanCorrosionPercent, byClass };
}

/**
 * Removes one photo/image from a still-queued (not yet synced) part and
 * updates its in-place stats — used to edit a pending part before it's ever
 * reached the server, rather than deleting the whole thing and starting over.
 * No-op (returns the part unchanged) for "append" entries, which aren't
 * editable this way.
 */
export async function deleteImageFromQueuedPart(id: string, uri: string): Promise<QueuedPart | null> {
  const queue = await readQueue();
  const index = queue.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const part = queue[index];

  if (part.kind === "upload") {
    const target = part.photos.find((p) => p.uri === uri);
    if (target) {
      try {
        new File(target.uri).delete();
      } catch {
        // best effort cleanup only
      }
    }
    const updated: QueuedUploadPart = { ...part, photos: part.photos.filter((p) => p.uri !== uri) };
    queue[index] = updated;
    await writeQueue(queue);
    return updated;
  }

  if (part.kind === "on_device") {
    const target = part.images.find((i) => i.uri === uri);
    if (target) {
      try {
        new File(target.uri).delete();
      } catch {
        // best effort cleanup only
      }
    }
    const images = part.images.filter((i) => i.uri !== uri);
    const { meanCorrosionPercent, byClass } = recomputeOnDeviceAggregate(images);
    const updated: QueuedOnDevicePart = { ...part, images, meanCorrosionPercent, byClass };
    queue[index] = updated;
    await writeQueue(queue);
    return updated;
  }

  return part;
}

/**
 * Adds more photos to a still-queued (not yet synced) part, keeping it as
 * ONE pending entry rather than a second, separate one. For an "upload" part
 * (nothing inspected yet), the new photos are just added to the raw set. For
 * an "on_device" part (already inspected), only the NEW photos are run
 * through the model — the existing images' stats are reused as-is — and the
 * part's aggregate stats are recomputed from the combined set.
 */
export async function addPhotosToQueuedPart(id: string, newPhotos: LocalPhoto[]): Promise<QueuedPart | null> {
  if (newPhotos.length === 0) return null;
  const queue = await readQueue();
  const index = queue.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const part = queue[index];
  const dir = offlineDir();

  if (part.kind === "upload") {
    const storedPhotos: LocalPhoto[] = newPhotos.map((photo, i) => {
      const dest = new File(dir, `${id}_extra_${Date.now()}_${i}_${safeName(photo.fileName)}`);
      new File(photo.uri).copy(dest);
      return { uri: dest.uri, fileName: photo.fileName, mimeType: photo.mimeType };
    });
    const updated: QueuedUploadPart = { ...part, photos: [...part.photos, ...storedPhotos] };
    queue[index] = updated;
    await writeQueue(queue);
    return updated;
  }

  if (part.kind === "on_device") {
    const partDir = new Directory(dir, id);
    partDir.create({ intermediates: true, idempotent: true });
    const batch = await runOnDeviceInspection(newPhotos);
    const newImages = writeBase64ImagesToDir(partDir, batch.images);
    const images = [...part.images, ...newImages];
    const { meanCorrosionPercent, byClass } = recomputeOnDeviceAggregate(images);
    const updated: QueuedOnDevicePart = { ...part, images, meanCorrosionPercent, byClass };
    queue[index] = updated;
    await writeQueue(queue);
    return updated;
  }

  return part;
}

/**
 * Batch version of the two functions above — given the photo list a capture
 * screen started with and what the user ended up with, applies the diff
 * (delete removed, add new) to a still-queued part in one call.
 */
export async function saveQueuedPartPhotoEdits(
  id: string,
  initialPhotos: LocalPhoto[],
  finalPhotos: LocalPhoto[]
): Promise<QueuedPart | null> {
  if (finalPhotos.length === 0) {
    throw new Error("A part must keep at least one photo.");
  }
  const finalUris = new Set(finalPhotos.map((p) => p.uri));
  const initialUris = new Set(initialPhotos.map((p) => p.uri));
  const removed = initialPhotos.filter((p) => !finalUris.has(p.uri));
  const added = finalPhotos.filter((p) => !initialUris.has(p.uri));

  for (const photo of removed) {
    await deleteImageFromQueuedPart(id, photo.uri);
  }
  if (added.length > 0) {
    await addPhotosToQueuedPart(id, added);
  }
  const queue = await readQueue();
  return queue.find((p) => p.id === id) || null;
}

export async function getQueue(): Promise<QueuedPart[]> {
  return readQueue();
}

export async function getQueueForSurvey(
  projectName: string,
  surveyName: string
): Promise<QueuedPart[]> {
  const queue = await readQueue();
  return queue.filter((p) => p.projectName === projectName && p.surveyName === surveyName);
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue();
  const part = queue.find((p) => p.id === id);
  if (part) {
    const uris =
      part.kind === "on_device" || part.kind === "append"
        ? part.images.map((i) => i.uri)
        : part.photos.map((p) => p.uri);
    for (const uri of uris) {
      try {
        new File(uri).delete();
      } catch {
        // best effort cleanup only
      }
    }
  }
  await writeQueue(queue.filter((p) => p.id !== id));
}

let syncInFlight = false;

/**
 * Attempts to upload every queued part for this company, in order. Stops at
 * the first failure (almost always "still offline") rather than burning
 * through the whole queue against a dead connection.
 *
 * Several screens trigger this opportunistically on mount, so it guards
 * against overlapping runs — otherwise two screens syncing at once could
 * both grab the same queued part and upload it twice.
 */
export async function syncQueue(
  session: VisionSession
): Promise<{ uploaded: number; remaining: number; error: string | null }> {
  if (syncInFlight) {
    const remaining = (await readQueue()).filter(
      (p) => p.companyId === session.companyId || p.companyName === session.companyName
    ).length;
    return { uploaded: 0, remaining, error: null };
  }

  syncInFlight = true;
  try {
    const queue = await readQueue();
    const mine = queue.filter(
      (p) => p.companyId === session.companyId || p.companyName === session.companyName
    );

    let uploaded = 0;
    let error: string | null = null;

    for (const part of mine) {
      try {
        if (part.kind === "on_device") {
          const created = await uploadPrecomputedResult(
            session,
            part.projectName,
            part.surveyName,
            part.regionName,
            part.images,
            part.classNames,
            part.meanCorrosionPercent,
            part.byClass,
            part.baselineInferenceId,
            { componentName: part.componentName, notes: part.notes, assessment: part.assessment }
          );
          // Confirming while offline was already the user's explicit
          // decision — auto-confirm the synced job too, same as the live
          // on-device-confirm path does.
          try {
            await confirmInferencePart(session, created.inferenceId);
          } catch {
            // Best-effort — the user can still confirm manually later.
          }
        } else if (part.kind === "append") {
          await uploadImagesToExistingJob(session, part.targetInferenceId, part.images, part.classNames);
        } else {
          await startInspect(
            session,
            part.projectName,
            part.surveyName,
            part.regionName,
            part.photos,
            part.baselineInferenceId || undefined,
            part.photoMatches,
            { componentName: part.componentName, notes: part.notes }
          );
        }
        await removeFromQueue(part.id);
        uploaded += 1;
      } catch (err) {
        error = err instanceof Error ? err.message : "Sync failed";
        break;
      }
    }

    const remaining = (await readQueue()).filter(
      (p) => p.companyId === session.companyId || p.companyName === session.companyName
    ).length;

    return { uploaded, remaining, error };
  } finally {
    syncInFlight = false;
  }
}
