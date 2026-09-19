/**
 * Supabase access for the server side.
 *
 * The game server is the ONLY writer of gameplay state and talks to Supabase with the
 * service-role key (bypasses RLS). Supabase is persistence + auth behind the server; the
 * live real-time game never runs through it (that is the in-memory world + WebSockets).
 *
 * Phase 1 only needs a reachability check, and it is optional at boot: with no key set the
 * server still runs the connect/echo loop and just reports Supabase as "not configured yet".
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.ts";

export type SupabaseHealth = {
  configured: boolean;
  reachable: boolean;
  detail: string;
};

/**
 * A service-role client, or null if the service key is not set. Callers must handle null
 * (Phase 1 does not persist anything, so a null client is fine here).
 */
export function getServiceClient(cfg: AppConfig): SupabaseClient | null {
  const { url, serviceRoleKey } = cfg.supabase;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Lightweight reachability probe against the project's PostgREST root. */
export async function checkSupabase(cfg: AppConfig): Promise<SupabaseHealth> {
  const { url, serviceRoleKey, anonKey } = cfg.supabase;
  if (!url) {
    return { configured: false, reachable: false, detail: "SUPABASE_URL not set" };
  }
  const key = serviceRoleKey ?? anonKey;
  if (!key) {
    return {
      configured: true,
      reachable: false,
      detail: "URL set but no key (add SUPABASE_SERVICE_ROLE_KEY for Phase 2)",
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    // PostgREST root returns 200 (OpenAPI) when reachable with a valid key.
    const which = serviceRoleKey ? "service key" : "anon key only";
    if (res.status === 403 || res.status === 407) {
      // In this dev container an egress proxy denies the Supabase host with 403 — that is a
      // network-policy block, not an auth failure. See the Phase 1 note.
      return {
        configured: true,
        reachable: false,
        detail: `HTTP ${res.status} — blocked by egress policy or unauthorized (${which})`,
      };
    }
    return { configured: true, reachable: res.ok, detail: `HTTP ${res.status} (${which})` };
  } catch (err) {
    return { configured: true, reachable: false, detail: `unreachable: ${String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
