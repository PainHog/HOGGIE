/** Environment config, loaded from the repo-root .env and validated once at boot. */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { DEFAULT_CONTENT_DIR, ENV_FILE } from "./paths.ts";

loadDotenv({ path: ENV_FILE });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4100),
  CONTENT_DIR: z.string().min(1).default(DEFAULT_CONTENT_DIR),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type AppConfig = {
  port: number;
  contentDir: string;
  supabase: {
    url?: string;
    anonKey?: string;
    serviceRoleKey?: string;
  };
};

export function loadConfig(): AppConfig {
  const env = EnvSchema.parse(process.env);
  return {
    port: env.PORT,
    contentDir: env.CONTENT_DIR,
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}
