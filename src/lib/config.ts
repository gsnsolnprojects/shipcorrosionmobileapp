import AsyncStorage from "@react-native-async-storage/async-storage";

const ENV_API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export const PIXEL_DISCLAIMER =
  "% of this photo’s pixels tagged as rust, not % of the real steel surface.";

const API_BASE_URL_OVERRIDE_KEY = "visionm.config.apiBaseUrlOverride";
let apiBaseUrlOverride: string | null = null;

/**
 * Loads any server address the user has entered on-device, so the app can point
 * at a new backend (new WiFi, new tunnel URL, etc.) without needing a rebuild.
 * Call once at app startup, before rendering, so getApiBaseUrl() is accurate.
 */
export async function loadApiBaseUrlOverride(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(API_BASE_URL_OVERRIDE_KEY);
    apiBaseUrlOverride = saved && saved.trim() ? saved.trim().replace(/\/+$/, "") : null;
  } catch {
    apiBaseUrlOverride = null;
  }
}

export function getApiBaseUrl(): string {
  return apiBaseUrlOverride || ENV_API_BASE_URL;
}

/** Pass an empty string to clear the override and fall back to the build-time default. */
export async function setApiBaseUrlOverride(url: string): Promise<void> {
  const cleaned = url.trim().replace(/\/+$/, "");
  apiBaseUrlOverride = cleaned || null;
  if (cleaned) {
    await AsyncStorage.setItem(API_BASE_URL_OVERRIDE_KEY, cleaned);
  } else {
    await AsyncStorage.removeItem(API_BASE_URL_OVERRIDE_KEY);
  }
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return base ? `${base}/${p}` : `/${p}`;
}

/** Backend image URLs are often `/api/inference/...` while API_BASE already ends in `/api`. */
export function resolveMediaUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = getApiBaseUrl().replace(/\/api\/?$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${origin}${path}`;
}

export function envReady(): string | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return "Missing Supabase configuration. Contact the app admin.";
  }
  const base = getApiBaseUrl();
  if (!base) {
    return "No server address set. Use Server settings below to enter one.";
  }
  if (/localhost|127\.0\.0\.1/i.test(base)) {
    return "Server address uses localhost. A phone cannot reach a PC that way — use its LAN IP or a tunnel URL.";
  }
  return null;
}
