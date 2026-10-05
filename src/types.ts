export type VisionSession = {
  accessToken: string;
  userId: string;
  email: string;
  role: string;
  companyId: string | null;
  companyName: string;
};

export type Severity = "low" | "medium" | "high" | "critical";
export type DamageTag = "peeling" | "cracking" | "blistering" | "exposed_metal";

/** The inspector's confirmed assessment of a part: the severity they signed off on (the AI band is only a suggestion) plus damage types they see. */
export type Assessment = {
  severity: Severity | null;
  damageTags: DamageTag[];
  assessedBy?: string | null;
  assessedAt?: string | null;
};

/** A reviewer's verdict (set on the web dashboard) on how a visit compares with an earlier one. */
export type VisitReview = {
  verdict: "worse" | "same" | "better";
  note: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comparedToInferenceId: string | null;
};

export type LocalPhoto = {
  uri: string;
  fileName: string;
  mimeType: string;
};

export type CorrosionByClass = {
  class: string;
  classId?: number;
  percent?: number;
  meanPercent?: number;
  count: number;
  avgConfidence?: number;
};

export type ResultImage = {
  filename: string;
  url: string;
  tag?: string;
  corrosionPercentTotal?: number;
  byClass?: CorrosionByClass[];
  instanceCount?: number;
  /** Resurvey only — the baseline job's photo filename this one was shot to match, or omitted for an extra/new photo. */
  matchedBaselineFilename?: string | null;
};

export type InspectResults = {
  inferenceId: string;
  regionName: string | null;
  surveyName?: string | null;
  images: ResultImage[];
  batch: {
    imageCount?: number;
    meanCorrosionPercent?: number;
    byClass?: CorrosionByClass[];
    classNames?: string[];
  } | null;
  classNames?: string[];
  confirmed?: boolean;
  confirmedAt?: string | null;
  /** Resurvey only — the earlier job this one is explicitly compared against. */
  baselineInferenceId?: string | null;
  /** Optional spot within the area (e.g. "Fuel pump") and the inspector's note, entered at capture. */
  componentName?: string;
  notes?: string;
  /** The inspector's severity + damage-type assessment (set on the results screen). */
  assessment?: Assessment | null;
};

/** Which of a resurvey job's own photos (by filename) match which baseline photo. */
export type PhotoMatch = { filename: string; matchedBaselineFilename: string | null };

export type ProjectRow = {
  id: string;
  name: string;
};

export type SurveySummary = {
  surveyName: string;
  partCount: number;
  completedPartCount: number;
  visitCount: number;
  overallMeanCorrosionPercent: number | null;
  updatedAt: string | null;
};

export type SurveyVisit = {
  inferenceId: string;
  status: string;
  regionName: string;
  surveyName: string;
  createdAt: string;
  completedAt?: string | null;
  imageCount: number;
  meanCorrosionPercent: number | null;
  byClass: CorrosionByClass[];
  /** True for a part captured offline and not yet uploaded to the server. */
  offline?: boolean;
  /** Set when this visit is an explicit resurvey of an earlier job. */
  baselineInferenceId?: string | null;
  observationId?: string | null;
  componentName?: string;
  notes?: string;
  inspectorName?: string | null;
  assessment?: Assessment | null;
  /** The spot's previous completed visit, linked automatically — lets any revisit be compared with the one before it. */
  previousInferenceId?: string | null;
  review?: VisitReview | null;
};

export type SurveyPart = {
  /** Unique within a survey: the observation id, or (older data) the area name. */
  partKey: string;
  regionName: string;
  /** The specific spot within the area, e.g. "Fuel pump" (empty = whole area). */
  componentName: string;
  /** Auto-assigned spot id, e.g. OBS-0004 (null until the server has assigned one). */
  observationId: string | null;
  inspectorName: string | null;
  notes: string;
  assessment?: Assessment | null;
  visitCount: number;
  meanCorrosionPercent: number | null;
  imageCount: number;
  byClass: CorrosionByClass[];
  latest: SurveyVisit;
  latestCompleted: SurveyVisit | null;
  visits: SurveyVisit[];
  /** Mobile-only, never sent by the server: photo(s) queued offline to be appended to this part's latest job. */
  pendingAppendCount?: number;
};

export type SurveyDetail = {
  surveyName: string;
  partCount: number;
  completedPartCount: number;
  visitCount: number;
  overallMeanCorrosionPercent: number | null;
  byClass: CorrosionByClass[];
  classNames?: string[];
  updatedAt: string | null;
  parts: SurveyPart[];
};

export type ComparisonPhotoPair = {
  baselineFilename: string;
  currentFilename: string;
  baselinePercent: number | null;
  currentPercent: number | null;
  delta: number | null;
};

export type ComparisonExtraPhoto = { filename: string; percent: number | null };

/** One visit of a spot, offered as a "compare against" choice. */
export type ObservationVisitOption = {
  inferenceId: string;
  surveyName: string;
  createdAt: string;
  meanCorrosionPercent: number | null;
  /** 'initial' = the spot's first visit; 'after_repair' = first visit after a closed repair. */
  baselineKind: "initial" | "after_repair" | null;
  review: VisitReview | null;
};

export type CompareResult = {
  /** 'matched' = exactly the photos re-shot in a guided resurvey; 'by_order' = paired by capture order (best effort). */
  pairing: "matched" | "by_order";
  defaultBaselineInferenceId: string | null;
  observationVisits: ObservationVisitOption[];
  review: VisitReview | null;
  baseline: { inferenceId: string; surveyName: string; createdAt: string; meanCorrosionPercent: number | null };
  current: { inferenceId: string; surveyName: string; createdAt: string; meanCorrosionPercent: number | null };
  pairs: ComparisonPhotoPair[];
  extraCurrent: ComparisonExtraPhoto[];
  unmatchedBaseline: ComparisonExtraPhoto[];
  overallDelta: number | null;
};

/** Optional extras entered on the capture screen and sent with an inspection. */
export type CaptureExtras = { componentName?: string; notes?: string; assessment?: Assessment | null };

/** "Engine room › Fuel pump", or just the area when the spot has no component. */
export function partLabel(p: { regionName: string; componentName?: string | null }): string {
  return p.componentName ? `${p.regionName} › ${p.componentName}` : p.regionName;
}

/** A spot already known on this vessel, offered while naming a part. */
export type KnownSpot = { observationId: string; componentName: string };
