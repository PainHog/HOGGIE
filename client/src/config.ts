/** Client config from Expo public env (inlined at build time). See .env.example. */
export const CONFIG = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:4100",
};
