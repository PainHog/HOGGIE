/** Environment config, loaded from the repo-root .env and validated once at boot. */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { DEFAULT_CONTENT_DIR, ENV_FILE } from "./paths.ts";

loadDotenv({ path: ENV_FILE });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4100),
  CONTENT_DIR: z.string().min(1).default(DEFAULT_CONTENT_DIR),
  /** Which MINE area files to load into the world. `all` = the whole game (every extracted zone
   *  except the vnum-colliding event/seasonal variants; see ALL_LOAD_EXCLUDES in world/loader.ts).
   *  Or name specific files, comma-separated (e.g. `drazuni.are,drazpost.are` for the start slice). */
  WORLD_AREAS: z.string().default("all"),
  /** Room vnum new characters spawn into (University of Alden entrance). */
  START_ROOM: z.coerce.number().int().default(10300),
  /** Emails auto-granted the admin role on login (bootstrap the owner). Comma-separated. */
  ADMIN_EMAILS: z.string().default(""),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type AppConfig = {
  port: number;
  contentDir: string;
  worldAreas: string[];
  startRoom: number;
  adminEmails: string[];
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
    worldAreas: env.WORLD_AREAS.split(",").map((s) => s.trim()).filter(Boolean),
    startRoom: env.START_ROOM,
    adminEmails: env.ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}
