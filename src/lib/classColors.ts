/**
 * Overlay colors must match VisionBackend/inference-scripts/run_inference.py
 * CLASS_MASK_COLORS_BGR (OpenCV BGR → hex RGB).
 */
export const CLASS_MASK_COLORS = [
  "#FFFF00", // 0 yellow
  "#FF00FF", // 1 magenta
  "#00DC00", // 2 lime
  "#005AFF", // 3 blue
  "#FF8C00", // 4 orange
  "#00FFFF", // 5 cyan
  "#FF00B4", // 6 violet
  "#A0FF00", // 7 mint
];

export type ClassLegendItem = {
  class: string;
  classId?: number | null;
  percent?: number | null;
  meanPercent?: number | null;
  count?: number;
};

/** YOLO class id used to paint the mask. Prefer classId from the API. */
export function classIndexFromName(name: string, orderedNames?: string[]): number {
  const raw = String(name || "").trim();
  if (!raw) return 0;
  if (orderedNames?.length) {
    const i = orderedNames.findIndex((n) => n.toLowerCase() === raw.toLowerCase());
    if (i >= 0) return i;
  }
  const classN = raw.match(/^class[_\s-]?(\d+)$/i);
  if (classN) return Number(classN[1]);
  const stage = raw.match(/^s(?:tage)?[_\s-]?(\d+)$/i);
  if (stage) return Math.max(0, Number(stage[1]) - 1);
  return 0;
}

export function colorForClass(row: ClassLegendItem, orderedNames?: string[]): string {
  const fromId = typeof row.classId === "number" && Number.isFinite(row.classId) ? row.classId : null;
  const idx = fromId != null ? fromId : classIndexFromName(row.class, orderedNames);
  const pal = CLASS_MASK_COLORS.length;
  return CLASS_MASK_COLORS[((idx % pal) + pal) % pal];
}

export function uniqueClassItems(
  rows: ClassLegendItem[] | undefined | null,
  orderedNames?: string[]
): ClassLegendItem[] {
  const map = new Map<string, ClassLegendItem>();
  for (const row of rows || []) {
    const name = String(row.class || "").trim();
    if (!name) continue;
    if (!map.has(name)) {
      const classId =
        typeof row.classId === "number"
          ? row.classId
          : classIndexFromName(name, orderedNames);
      map.set(name, { ...row, class: name, classId });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      (Number(a.classId) || 0) - (Number(b.classId) || 0) || a.class.localeCompare(b.class)
  );
}
