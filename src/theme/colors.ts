export type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentStrong: string;
  accentText: string;
  sea: string;
  danger: string;
  dangerBg: string;
  success: string;
};

// The existing dark palette already reads as a maritime safety/hazard scheme
// (deep navy hull + hazard orange) — kept close to what already shipped.
export const darkTheme: ThemeColors = {
  background: "#0f172a",
  surface: "#111827",
  surfaceAlt: "#1e293b",
  surfaceBorder: "#1e293b",
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  accent: "#ea580c",
  accentStrong: "#fb923c",
  accentText: "#fb923c",
  sea: "#22d3ee",
  danger: "#fca5a5",
  dangerBg: "#3f2d12",
  success: "#4ade80",
};

export const lightTheme: ThemeColors = {
  background: "#f1f5f9",
  surface: "#ffffff",
  surfaceAlt: "#f8fafc",
  surfaceBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  accent: "#ea580c",
  accentStrong: "#c2410c",
  accentText: "#c2410c",
  sea: "#0e7490",
  danger: "#dc2626",
  dangerBg: "#fef3c7",
  success: "#16a34a",
};
