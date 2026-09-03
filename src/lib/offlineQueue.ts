import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { startInspect } from "./api";
import type { LocalPhoto, VisionSession } from "../types";

const QUEUE_KEY = "visionm.offlineQueue.v1";

export type QueuedPart = {
  id: string;
  companyId: string | null;
  companyName: string;
  projectName: string;
  surveyName: string;
  regionName: string;
  createdAt: string;
  photos: LocalPhoto[];
};

function offlineDir(): Directory {
  const dir = new Directory(Paths.document, "offline-inspect");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function readQueue(): Promise<QueuedPart[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
}): Promise<QueuedPart> {
  const dir = offlineDir();
  const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const storedPhotos: LocalPhoto[] = input.photos.map((photo, index) => {
    const dest = new File(dir, `${id}_${index}_${safeName(photo.fileName)}`);
    new File(photo.uri).copy(dest);
    return { uri: dest.uri, fileName: photo.fileName, mimeType: photo.mimeType };
  });

  const part: QueuedPart = {
    id,
    companyId: input.companyId,
    companyName: input.companyName,
    projectName: input.projectName,
    surveyName: input.surveyName,
    regionName: input.regionName,
    createdAt: new Date().toISOString(),
    photos: storedPhotos,
  };

  const queue = await readQueue();
  queue.push(part);
  await writeQueue(queue);
  return part;
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
    for (const photo of part.photos) {
      try {
        new File(photo.uri).delete();
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
        await startInspect(session, part.projectName, part.surveyName, part.regionName, part.photos);
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
