/**
 * Server boot.
 *
 * Load config -> proxy wiring -> load the world from content JSON -> wire Supabase (auth + db)
 * -> start the WebSocket server, handing each connection a game Session. The live game runs in
 * this process's memory; Supabase is persistence + auth behind it.
 */
import { loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { configureOutboundProxy } from "./net/httpProxy.ts";
import { checkSupabase, getServiceClient } from "./db/supabase.ts";
import { loadWorld } from "./world/loader.ts";
import { Authenticator } from "./auth/verify.ts";
import { Db } from "./db/repos.ts";
import { LiveWorld } from "./game/liveWorld.ts";
import { CombatManager } from "./game/combat.ts";
import { Economy } from "./game/economy.ts";
import { GameTick } from "./game/tick.ts";
import { populateWorld } from "./game/spawn.ts";
import { Session, type GameServices } from "./game/session.ts";
import { startWsServer, type WsHandle } from "./net/wsServer.ts";

async function main(): Promise<void> {
  configureOutboundProxy();
  const cfg = loadConfig();

  log.info("House of Ghouls server booting", { port: cfg.port, startRoom: cfg.startRoom });

  const world = await loadWorld(cfg.contentDir, cfg.worldAreas);
  const live = new LiveWorld(world);
  const combat = new CombatManager(world, live, cfg);
  const economy = new Economy();
  const auth = new Authenticator(cfg);
  const serviceClient = getServiceClient(cfg);
  const db = serviceClient ? new Db(serviceClient) : null;

  const spawned = populateWorld(live);
  log.info("world populated from resets", { mobsSpawned: spawned });

  const tick = new GameTick(live, combat);
  tick.start();

  const health = await checkSupabase(cfg);
  if (health.reachable) log.info("Supabase reachable", { detail: health.detail });
  else log.warn("Supabase not reachable", { detail: health.detail });
  if (!db) {
    log.warn("no Supabase service key — accounts/persistence disabled (set SUPABASE_SERVICE_ROLE_KEY)");
  }

  const services: GameServices = { config: cfg, world, live, auth, db, combat, economy };
  const server: WsHandle = await startWsServer({
    port: cfg.port,
    createHandler: (conn) => new Session(conn, services),
  });
  log.info(`House of Ghouls is live on ws://localhost:${server.port}`, {
    accounts: db ? "enabled" : "disabled",
    hint: "run `npm run test-client` in another terminal",
  });

  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    tick.stop();
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
