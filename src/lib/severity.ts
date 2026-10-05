import type { ThemeColors } from "../theme/colors";

/**
 * Mirrors VisionBackend/utils/severity.js's thresholds exactly, so the ship
 * zone map's colors match the web dashboard and PDF export.
 */
export type SeverityBand = "low" | "medium" | "high" | "critical" | null;

const THRESHOLDS: { max: number; band: Exclude<SeverityBand, null> }[] = [
  { max: 5, band: "low" },
  { max: 15, band: "medium" },
  { max: 30, band: "high" },
  { max: Infinity, band: "critical" },
];

export function deriveSeverityBand(pct: number | null | undefined): SeverityBand {
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0) return null;
  return THRESHOLDS.find((t) => pct < t.max)!.band;
}

const AMBER = "#f59e0b";
const ORANGE_HIGH = "#f97316";

export function severityColor(band: SeverityBand, colors: ThemeColors): string {
  switch (band) {
    case "low":
      return colors.success;
    case "medium":
      return AMBER;
    case "high":
      return ORANGE_HIGH;
    case "critical":
      return colors.danger;
    default:
      return colors.textMuted;
  }
}
