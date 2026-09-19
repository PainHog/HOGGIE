/** Supabase client for auth only (the game itself runs over the WebSocket to the Node server). */
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "./config";

export const supabaseConfigured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// Fall back to harmless placeholders so importing this module never throws when env is unset;
// App shows a config message via `supabaseConfigured` instead.
export const supabase = createClient(
  CONFIG.supabaseUrl || "http://localhost:54321",
  CONFIG.supabaseAnonKey || "anon",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
