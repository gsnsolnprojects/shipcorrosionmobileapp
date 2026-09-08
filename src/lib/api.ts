import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiUrl, resolveMediaUrl } from "./config";
import { authHeaderRecord } from "./session";
import { compressForUpload } from "./compressPhoto";
import type {
  InspectResults,
  LocalPhoto,
  ProjectRow,
  ResultImage,
  SurveyDetail,
  SurveySummary,
  VisionSession,
} from "../types";
import { supabase } from "./supabase";

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Registered once by App.tsx so any 401 anywhere drops the user back to login. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function throwIfUnauthorized(res: Response): Promise<void> {
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("Session expired. Please log in again.");
  }
}

/** Caches the last-known-good response for a key so screens still render offline. */
async function cacheGet<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const value = await fetcher();
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
    return value;
  } catch (err) {
    const cached = await AsyncStorage.getItem(key);
    if (cached != null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // fall through to rethrow below
      }
    }
    throw err;
  }
}

export async function fetchProjects(companyId: string): Promise<ProjectRow[]> {
  return cacheGet(`visionm.cache.projects.${companyId}`, async () => {
    // This app is exclusively for corrosion inspection — only ever show
    // projects flagged as such, never a company's other vision projects.
    const { data, error } = await supabase
      .from("projects")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("project_type", "corrosion")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((p) => ({ id: String(p.id), name: String(p.name) }));
  });
}

/**
 * Renames a project/vessel: updates the canonical name in Supabase, then
 * asks the backend to cascade that rename across every MongoDB collection
 * scoped by company/project name (surveys, photos, actions, pinned model) —
 * otherwise that historical data would be orphaned under the old name.
 */
export async function renameProject(
  session: VisionSession,
  projectId: string,
  oldProjectName: string,
  newProjectName: string
): Promise<void> {
  const { error } = await supabase.from("projects").update({ name: newProjectName }).eq("id", projectId);
  if (error) throw new Error(error.message);

  try {
    const res = await fetch(apiUrl("/projects/rename"), {
      method: "POST",
      headers: authHeaderRecord(session, true),
      body: JSON.stringify({
        company: session.companyName,
        oldProjectName,
        newProjectName,
      }),
    });
    if (!res.ok) {
      await throwIfUnauthorized(res);
      throw new Error(await readError(res));
    }
  } catch (fetchErr) {
    // A raw "Network request failed" here almost always means the server
    // address in Settings is wrong/stale, not a bug in this call — make
    // that the visible message instead of a bare TypeError.
    if (fetchErr instanceof TypeError) {
      throw new Error(
        "Could not reach the server. Check the server address in Settings — it may be out of date."
      );
    }
    throw fetchErr;
  }

  await AsyncStorage.removeItem(`visionm.cache.projects.${session.companyId}`);
}

export async function startInspect(
  session: VisionSession,
  projectName: string,
  surveyName: string,
  regionName: string,
  photos: LocalPhoto[]
): Promise<{ inferenceId: string; status: string; message?: string }> {
  const form = new FormData();
  form.append("surveyName", surveyName);
  form.append("regionName", regionName);
  form.append("project", projectName);
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const uri = await compressForUpload(photo.uri);
    const base = (photo.fileName || `photo_${index}.jpg`).replace(/\.[^.]+$/, "");
    form.append("files", {
      uri,
      name: `${base}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob);
  }

  const res = await fetch(apiUrl("/mobile-inspect"), {
    method: "POST",
    headers: authHeaderRecord(session, false),
    body: form,
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  return res.json();
}

export async function deleteInferenceImage(
  session: VisionSession,
  inferenceId: string,
  filename: string
): Promise<{ batch: InspectResults["batch"]; remainingImages: number }> {
  const res = await fetch(
    apiUrl(`/inference/${encodeURIComponent(inferenceId)}/image/${encodeURIComponent(filename)}`),
    { method: "DELETE", headers: authHeaderRecord(session, true) }
  );
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  const json = await res.json();
  return { batch: json.corrosionStats || null, remainingImages: json.remainingImages };
}

export async function deleteInferenceJob(session: VisionSession, inferenceId: string): Promise<void> {
  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}`), {
    method: "DELETE",
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
}

export async function getInferenceStatus(
  session: VisionSession,
  inferenceId: string
): Promise<{
  status: string;
  progress?: { progressPercent?: number; processedImages?: number; totalImages?: number };
  error?: { message?: string };
  regionName?: string | null;
}> {
  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/status`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  return res.json();
}

function collectImages(payload: Record<string, unknown>): ResultImage[] {
  const results = (payload.results || payload) as Record<string, unknown>;
  const annotated = results.annotatedImages as
    | { all?: ResultImage[]; good?: ResultImage[]; defect?: ResultImage[] }
    | ResultImage[]
    | undefined;
  const fallback = (results.images as ResultImage[]) || [];
  let list: ResultImage[] = [];
  if (Array.isArray(annotated)) {
    list = annotated;
  } else if (annotated?.all && annotated.all.length) {
    list = annotated.all;
  } else if (annotated) {
    list = [...(annotated.good || []), ...(annotated.defect || [])];
  }
  if (list.length === 0) list = fallback;
  return list.map((img) => ({
    ...img,
    url: resolveMediaUrl(img.url),
  }));
}

export async function getInferenceResults(
  session: VisionSession,
  inferenceId: string
): Promise<InspectResults> {
  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/results`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  const json = await res.json();
  const results = json.results || json;
  return {
    inferenceId: json.inferenceId || inferenceId,
    regionName: json.regionName || null,
    surveyName: json.surveyName || null,
    images: collectImages(json),
    batch: results.corrosion || null,
    classNames: results.corrosion?.classNames || results.classNames || json.classNames || [],
  };
}

export async function listSurveys(
  session: VisionSession,
  projectName: string
): Promise<SurveySummary[]> {
  return cacheGet(
    `visionm.cache.surveys.${session.companyName}.${projectName}`,
    async () => {
      const qs = new URLSearchParams({
        company: session.companyName,
        project: projectName,
      });
      const res = await fetch(apiUrl(`/mobile-inspect/surveys?${qs.toString()}`), {
        headers: authHeaderRecord(session, true),
      });
      if (!res.ok) {
        await throwIfUnauthorized(res);
        throw new Error(await readError(res));
      }
      const json = await res.json();
      return json.surveys || [];
    }
  );
}

export async function getSurvey(
  session: VisionSession,
  projectName: string,
  surveyName: string
): Promise<SurveyDetail> {
  return cacheGet(
    `visionm.cache.survey.${session.companyName}.${projectName}.${surveyName}`,
    async () => {
      const qs = new URLSearchParams({
        company: session.companyName,
        project: projectName,
        surveyName,
      });
      const res = await fetch(apiUrl(`/mobile-inspect/survey?${qs.toString()}`), {
        headers: authHeaderRecord(session, true),
      });
      if (!res.ok) {
        await throwIfUnauthorized(res);
        throw new Error(await readError(res));
      }
      const json = await res.json();
      return json.survey;
    }
  );
}

const imageDataUrlCache = new Map<string, string>();

export async function fetchAuthImageDataUrl(
  session: VisionSession,
  url: string
): Promise<string | null> {
  const cached = imageDataUrlCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url, { headers: authHeaderRecord(session, false) });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized?.();
      return null;
    }
    const buffer = await res.arrayBuffer();
    const dataUrl = `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(buffer))}`;
    imageDataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch (err) {
    console.warn("fetchAuthImageDataUrl failed", err);
    return null;
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[triple & 63] : "=";
  }
  return out;
}
