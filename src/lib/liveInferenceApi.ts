import { apiUrl } from "./config";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { authHeaderRecord } from "./session";
import type { VisionSession } from "../types";

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

/** The project's pinned YOLO_SEG model — needed to start a server live session. */
export async function getPinnedModel(
  session: VisionSession,
  projectName: string
): Promise<{ mongoModelId: string; confidenceThreshold: number } | null> {
  const qs = new URLSearchParams({ company: session.companyName, project: projectName });
  const res = await fetchWithTimeout(apiUrl(`/mobile-inspect/config?${qs.toString()}`), {
    headers: authHeaderRecord(session, true),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  if (!json.config || !json.config.mongoModelId) return null;
  return {
    mongoModelId: json.config.mongoModelId,
    confidenceThreshold: typeof json.config.confidenceThreshold === "number" ? json.config.confidenceThreshold : 0.25,
  };
}

export async function startLiveSession(
  session: VisionSession,
  modelId: string,
  confidenceThreshold: number
): Promise<{ inferenceId: string; confidenceThreshold: number }> {
  const res = await fetchWithTimeout(apiUrl("/inference/live/start"), {
    method: "POST",
    headers: authHeaderRecord(session, true),
    body: JSON.stringify({ modelId, confidenceThreshold }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = await res.json();
  return { inferenceId: json.inferenceId, confidenceThreshold: json.confidenceThreshold };
}

export type LiveDetection = {
  class: string;
  confidence: number;
  bbox: [number, number, number, number];
  polygon?: [number, number][];
};

export async function processLiveFrame(
  session: VisionSession,
  inferenceId: string,
  base64Jpeg: string
): Promise<{ detections: LiveDetection[]; imageWidth: number; imageHeight: number }> {
  // Short timeout — this is called in a tight polling loop (every
  // SERVER_FRAME_GAP_MS), so a hung request must fail fast or the whole
  // live-scan loop effectively freezes for as long as each hang lasts.
  const res = await fetchWithTimeout(
    apiUrl(`/inference/live/${encodeURIComponent(inferenceId)}/frame`),
    {
      method: "POST",
      headers: authHeaderRecord(session, true),
      body: JSON.stringify({ image: `data:image/jpeg;base64,${base64Jpeg}`, returnAnnotatedImage: false }),
    },
    4000
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function stopLiveSession(session: VisionSession, inferenceId: string): Promise<void> {
  try {
    await fetchWithTimeout(
      apiUrl(`/inference/live/${encodeURIComponent(inferenceId)}/stop`),
      {
        method: "POST",
        headers: authHeaderRecord(session, true),
      },
      4000
    );
  } catch {
    // Best-effort — leaving the screen shouldn't hang on a slow/failed stop call.
  }
}
