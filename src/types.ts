export type VisionSession = {
  accessToken: string;
  userId: string;
  email: string;
  role: string;
  companyId: string | null;
  companyName: string;
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
};

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
};

export type SurveyPart = {
  regionName: string;
  visitCount: number;
  meanCorrosionPercent: number | null;
  imageCount: number;
  byClass: CorrosionByClass[];
  latest: SurveyVisit;
  latestCompleted: SurveyVisit | null;
  visits: SurveyVisit[];
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
