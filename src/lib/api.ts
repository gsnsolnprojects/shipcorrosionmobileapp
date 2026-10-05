import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiUrl, resolveMediaUrl } from "./config";
import { authHeaderRecord } from "./session";
import { compressForUpload } from "./compressPhoto";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type {
  Assessment,
  CaptureExtras,
  CompareResult,
  InspectResults,
  KnownSpot,
  LocalPhoto,
  PhotoMatch,
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

/**
 * Stale-while-revalidate: if cached data exists, returns it IMMEDIATELY
 * (no waiting on the network at all — that's the whole point, vs. cacheGet
 * above which always waits on the network first). A fetch still happens in
 * the background; if it succeeds, `onFresh` is called with the new data so
 * the caller can update its already-rendered view. If it fails (offline,
 * unreachable), it's swallowed — the cached view already on screen is fine.
 * Falls back to a normal await-the-network call when there's no cache yet
 * (first-ever load for that key).
 */
async function cacheGetStale<T>(key: string, fetcher: () => Promise<T>, onFresh?: (data: T) => void): Promise<T> {
  const cachedRaw = await AsyncStorage.getItem(key);
  let cached: T | null = null;
  if (cachedRaw != null) {
    try {
      cached = JSON.parse(cachedRaw) as T;
    } catch {
      cached = null;
    }
  }

  if (cached != null) {
    fetcher()
      .then((fresh) => {
        AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => {});
        onFresh?.(fresh);
      })
      .catch(() => {
        // Still offline/unreachable — the cached view stays as-is.
      });
    return cached;
  }

  const fresh = await fetcher();
  AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => {});
  return fresh;
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

  // Retries a couple of times on a network-looking failure — the server can be
  // briefly unreachable (a restart, a momentary drop) rather than genuinely
  // misconfigured, and this call moves the project's data to match a Supabase
  // rename that already happened, so silently giving up after one try would
  // leave the vessel's surveys/actions orphaned under the old name.
  let lastNetworkErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
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
      lastNetworkErr = null;
      break;
    } catch (fetchErr) {
      if (!(fetchErr instanceof TypeError)) throw fetchErr;
      lastNetworkErr = fetchErr;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  if (lastNetworkErr) {
    // A raw "Network request failed" here almost always means the server
    // address in Settings is wrong/stale, not a bug in this call — make
    // that the visible message instead of a bare TypeError.
    throw new Error(
      "Could not reach the server. Check the server address in Settings — it may be out of date."
    );
  }

  await AsyncStorage.removeItem(`visionm.cache.projects.${session.companyId}`);
}

export async function startInspect(
  session: VisionSession,
  projectName: string,
  surveyName: string,
  regionName: string,
  photos: LocalPhoto[],
  baselineInferenceId?: string,
  photoMatches?: PhotoMatch[], // keyed by each photo's ORIGINAL fileName — re-keyed to the final uploaded name below
  extras?: CaptureExtras
): Promise<{ inferenceId: string; status: string; message?: string }> {
  const form = new FormData();
  form.append("surveyName", surveyName);
  form.append("regionName", regionName);
  form.append("project", projectName);
  const matchByOriginalName = new Map((photoMatches || []).map((m) => [m.filename, m.matchedBaselineFilename]));
  const finalPhotoMatches: PhotoMatch[] = [];
  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const uri = await compressForUpload(photo.uri);
    const base = (photo.fileName || `photo_${index}.jpg`).replace(/\.[^.]+$/, "");
    const finalName = `${base}.jpg`;
    form.append("files", {
      uri,
      name: finalName,
      type: "image/jpeg",
    } as unknown as Blob);
    if (matchByOriginalName.has(photo.fileName)) {
      finalPhotoMatches.push({ filename: finalName, matchedBaselineFilename: matchByOriginalName.get(photo.fileName) ?? null });
    }
  }
  if (baselineInferenceId) form.append("baselineInferenceId", baselineInferenceId);
  if (extras?.componentName?.trim()) form.append("componentName", extras.componentName.trim());
  if (extras?.notes?.trim()) form.append("notes", extras.notes.trim());
  if (finalPhotoMatches.length > 0) form.append("photoMatches", JSON.stringify(finalPhotoMatches));

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
  const res = await fetchWithTimeout(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/status`), {
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
  const res = await fetchWithTimeout(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/results`), {
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
    confirmed: json.confirmed || false,
    confirmedAt: json.confirmedAt || null,
    assessment: json.assessment || null,
  };
}

/** Marks a completed part as human-reviewed. Purely a review acknowledgment — the part is already part of the survey the moment photos were uploaded. */
export async function confirmInferencePart(
  session: VisionSession,
  inferenceId: string,
  assessment?: Assessment
): Promise<{ confirmed: boolean; confirmedAt: string | null }> {
  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/confirm`), {
    method: "POST",
    headers: authHeaderRecord(session, true),
    body: JSON.stringify(assessment ? { assessment } : {}),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  return res.json();
}

/**
 * Most recent completed job for a regionName in this project, from any
 * survey other than `excludeSurveyName` — powers the "this was surveyed
 * before, resurvey instead?" suggestion while naming a part in today's
 * already-open survey.
 */
export type RegionHistory = {
  /** Most recent completed job of this exact spot from another survey, if any. */
  job: {
    inferenceId: string;
    surveyName: string;
    createdAt: string;
    observationId: string | null;
    componentName: string;
    meanCorrosionPercent: number | null;
  } | null;
  /** The spot itself (with its OBS-#### id) when this area + component has been captured before. */
  observation: KnownSpot | null;
  /** Every known spot in this area, so component names can be offered as quick picks. */
  observations: KnownSpot[];
};

export async function getLatestForRegion(
  session: VisionSession,
  projectName: string,
  regionName: string,
  componentName?: string,
  excludeSurveyName?: string
): Promise<RegionHistory> {
  const qs = new URLSearchParams({ company: session.companyName, project: projectName, regionName });
  if (componentName?.trim()) qs.set("componentName", componentName.trim());
  if (excludeSurveyName) qs.set("excludeSurveyName", excludeSurveyName);
  const res = await fetchWithTimeout(apiUrl(`/mobile-inspect/region-history?${qs.toString()}`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  const json = await res.json();
  return { job: json.job || null, observation: json.observation || null, observations: json.observations || [] };
}

/** Saves (or changes) the inspector's severity + damage-type assessment of an already-saved part. */
export async function saveAssessment(
  session: VisionSession,
  inferenceId: string,
  assessment: Assessment
): Promise<Assessment> {
  const res = await fetch(apiUrl(`/inference/${encodeURIComponent(inferenceId)}/assessment`), {
    method: "PUT",
    headers: authHeaderRecord(session, true),
    body: JSON.stringify(assessment),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  const json = await res.json();
  return json.assessment;
}

/**
 * Spots (observation id, or area name for older data) in this project with a repair closed but not yet confirmed
 * by a resurvey — powers the "repair closed, resurvey to confirm" nudge on
 * the survey dashboard. Read-only; the actual action-item workflow lives on
 * the web dashboard.
 */
export async function getRegionsAwaitingResurvey(
  session: VisionSession,
  projectName: string
): Promise<Set<string>> {
  const qs = new URLSearchParams({
    company: session.companyName,
    project: projectName,
    status: "completed",
    limit: "200",
  });
  const res = await fetchWithTimeout(apiUrl(`/actions?${qs.toString()}`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  const json = await res.json();
  const actions: Array<{ regionName?: string | null; observationId?: string | null; needsResurvey?: boolean }> =
    json.actions || [];
  // Keyed by the spot (observation id, or the area name for older data).
  return new Set(
    actions
      .filter((a) => a.needsResurvey && (a.observationId || a.regionName))
      .map((a) => (a.observationId || a.regionName) as string)
  );
}

/** Baseline vs current photo-by-photo comparison for a resurveyed part. */
export async function getInspectionComparison(
  session: VisionSession,
  currentInferenceId: string,
  baselineInferenceId?: string
): Promise<CompareResult> {
  const qs = new URLSearchParams({ currentInferenceId });
  if (baselineInferenceId) qs.set("baselineInferenceId", baselineInferenceId);
  const res = await fetchWithTimeout(apiUrl(`/mobile-inspect/compare?${qs.toString()}`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) {
    await throwIfUnauthorized(res);
    throw new Error(await readError(res));
  }
  return res.json();
}

export async function listSurveys(
  session: VisionSession,
  projectName: string,
  onFresh?: (surveys: SurveySummary[]) => void
): Promise<SurveySummary[]> {
  return cacheGetStale(
    `visionm.cache.surveys.${session.companyName}.${projectName}`,
    async () => {
      const qs = new URLSearchParams({
        company: session.companyName,
        project: projectName,
      });
      const res = await fetchWithTimeout(apiUrl(`/mobile-inspect/surveys?${qs.toString()}`), {
        headers: authHeaderRecord(session, true),
      });
      if (!res.ok) {
        await throwIfUnauthorized(res);
        throw new Error(await readError(res));
      }
      const json = await res.json();
      return json.surveys || [];
    },
    onFresh
  );
}

export async function getSurvey(
  session: VisionSession,
  projectName: string,
  surveyName: string,
  onFresh?: (survey: SurveyDetail) => void
): Promise<SurveyDetail> {
  return cacheGetStale(
    `visionm.cache.survey.${session.companyName}.${projectName}.${surveyName}`,
    async () => {
      const qs = new URLSearchParams({
        company: session.companyName,
        project: projectName,
        surveyName,
      });
      const res = await fetchWithTimeout(apiUrl(`/mobile-inspect/survey?${qs.toString()}`), {
        headers: authHeaderRecord(session, true),
      });
      if (!res.ok) {
        await throwIfUnauthorized(res);
        throw new Error(await readError(res));
      }
      const json = await res.json();
      return json.survey;
    },
    onFresh
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
    const res = await fetchWithTimeout(url, { headers: authHeaderRecord(session, false) });
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

export function bytesToBase64(bytes: Uint8Array): string {
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
