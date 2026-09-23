/**
 * Authenticates a WebSocket connection from a Supabase access token (JWT).
 *
 * The client signs in with Supabase (Auth) and sends its access token on connect; the server
 * validates it against Supabase and maps it to an account. The token is verified with Supabase
 * (`auth.getUser`), so a forged/expired token is rejected.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.ts";

export interface AuthUser {
  userId: string;
  email: string | null;
}

export class Authenticator {
  private readonly client: SupabaseClient | null;

  constructor(cfg: AppConfig) {
    const url = cfg.supabase.url;
    const key = cfg.supabase.anonKey ?? cfg.supabase.serviceRoleKey;
    this.client =
      url && key
        ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }

  get available(): boolean {
    return this.client !== null;
  }

  async verify(token: string): Promise<AuthUser | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null };
  }
}
