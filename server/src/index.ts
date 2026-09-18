/**
 * Server boot.
 *
 * Phase 1: load config, stand up the empty World, probe Supabase (optional), start the
 * WebSocket server, and wait. No game loop yet — that arrives with combat in Phase 3.
 */
import { loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { checkSupabase } from "./db/supabase.ts";
import { World } from "./world/world.ts";
import { startWsServer, type WsHandle } from "./net/wsServer.ts";

async function main(): Promise<void> {
  const cfg = loadConfig();

  log.info("House of Ghouls server booting", {
    port: cfg.port,
    contentDir: cfg.contentDir,
  });

  // The authoritative in-memory world. Empty in Phase 1; loaded from content JSON in Phase 2.
  const world = new World();
  log.info("world model ready (empty)", world.summary());

  // Supabase is optional at boot: no service key yet just means Phase 2 persistence is not
  // wired. The connect/echo loop runs regardless.
  const health = await checkSupabase(cfg);
  if (!health.configured) {
    log.warn("Supabase not configured", { detail: health.detail });
  } else if (health.reachable) {
    log.info("Supabase reachable", { detail: health.detail });
  } else {
    log.warn("Supabase configured but not reachable", { detail: health.detail });
  }

  const server: WsHandle = await startWsServer({ port: cfg.port });
  log.info(`WebSocket server listening on ws://localhost:${server.port}`, {
    hint: "run `npm run test-client` in another terminal",
  });

  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal boot error", { err: String(err) });
  process.exit(1);
});
