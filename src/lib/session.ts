import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import type { VisionSession } from "../types";

const ROLES_WITH_INFERENCE = new Set([
  "platform_admin",
  "workspace_admin",
  "ml_engineer",
  "operator",
]);

export function canRunInference(role: string): boolean {
  return ROLES_WITH_INFERENCE.has(role);
}

const PROFILE_CACHE_KEY = "visionm.session.profileCache.v1";

/**
 * Reads the auth session (local, no network) then resolves company/role via Supabase.
 * If that lookup fails (offline at sea, etc.) falls back to the last successful
 * resolution cached on-device, so the app can still boot without connectivity.
 */
export async function loadVisionSession(): Promise<VisionSession | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const userId = session.user.id;
  const email = session.user.email || "";

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, role, company_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);

    let companyName = "";
    if (profile?.company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", profile.company_id)
        .maybeSingle();
      companyName = company?.name || "";
    }

    const resolved: VisionSession = {
      accessToken: session.access_token,
      userId: profile?.id || userId,
      email: profile?.email || email,
      role: profile?.role || "viewer",
      companyId: profile?.company_id || null,
      companyName,
    };
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(resolved)).catch(() => {});
    return resolved;
  } catch {
    const cachedRaw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!cachedRaw) return null;
    try {
      const cached = JSON.parse(cachedRaw) as VisionSession;
      return { ...cached, accessToken: session.access_token, userId };
    } catch {
      return null;
    }
  }
}

export function authHeaderRecord(session: VisionSession, json = true): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    "X-User-Id": session.userId,
    "X-User-Role": session.role,
    "X-User-Email": session.email,
    "X-User-Company": session.companyName || "",
  };
  if (session.companyId) {
    headers["X-User-Company-Id"] = session.companyId;
  }
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}
