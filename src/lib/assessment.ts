import type { Assessment, DamageTag, Severity } from "../types";

export const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const DAMAGE_TAG_OPTIONS: { value: DamageTag; label: string }[] = [
  { value: "peeling", label: "Peeling" },
  { value: "cracking", label: "Cracking" },
  { value: "blistering", label: "Blistering" },
  { value: "exposed_metal", label: "Exposed metal" },
];

export function severityLabel(s: Severity | null | undefined): string {
  return SEVERITY_OPTIONS.find((o) => o.value === s)?.label ?? "";
}

export function damageTagLabel(t: DamageTag): string {
  return DAMAGE_TAG_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

/** "High · Peeling, Blistering" — empty string when there is no assessment. */
export function assessmentSummary(a: Assessment | null | undefined): string {
  if (!a) return "";
  const parts = [severityLabel(a.severity), a.damageTags.map(damageTagLabel).join(", ")].filter(Boolean);
  return parts.join(" · ");
}
