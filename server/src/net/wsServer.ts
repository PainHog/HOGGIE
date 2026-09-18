/**
 * WebSocket game server — the front door.
 *
 * Phase 1 scope: accept connections, hand each a `welcome`, validate every inbound frame,
 * and answer ping/echo. No gameplay yet. The message handler is deliberately a small switch
 * that later phases extend (the `cmd` case currently just acknowledges).
 */
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientMessage, PROTOCOL_VERSION, type ClientMessage } from "@hoggie/shared";
import { log } from "../log.ts";
import { Connection } from "./connection.ts";

const SERVER_NAME = "House of Ghouls";
const HEARTBEAT_MS = 30_000;

export interface WsHandle {
  /** The bound port (useful when starting on port 0 in tests). */
  port: number;
  /** Number of currently connected sockets. */
  connectionCount(): number;
  /** Close the server and all sockets. */
  close(): Promise<void>;
}

export function startWsServer(opts: { port: number }): Promise<WsHandle> {
  const wss = new WebSocketServer({ port: opts.port });
  const connections = new Map<string, Connection>();

  wss.on("connection", (ws: WebSocket) => {
    const conn = new Connection(ws);
    connections.set(conn.id, conn);
    log.info("connection opened", { id: conn.id, total: connections.size });

    conn.send({
      t: "welcome",
      connectionId: conn.id,
      server: SERVER_NAME,
      protocol: PROTOCOL_VERSION,
    });

    ws.on("pong", () => {
      conn.isAlive = true;
    });

    ws.on("message", (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        conn.send({ t: "error", message: "malformed or unsupported message" });
        return;
      }
      handleMessage(conn, msg);
    });

    ws.on("close", () => {
      connections.delete(conn.id);
      log.info("connection closed", { id: conn.id, total: connections.size });
    });

    ws.on("error", (err) => {
      log.warn("socket error", { id: conn.id, err: String(err) });
    });
  });

  // Drop sockets that stopped answering pings.
  const heartbeat = setInterval(() => {
    for (const conn of connections.values()) {
      if (!conn.isAlive) {
        conn.ws.terminate();
        continue;
      }
      conn.isAlive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return new Promise<WsHandle>((resolve, reject) => {
    wss.on("error", reject);
    wss.on("listening", () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        port,
        connectionCount: () => connections.size,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(heartbeat);
            for (const conn of connections.values()) conn.ws.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}

function handleMessage(conn: Connection, msg: ClientMessage): void {
  switch (msg.t) {
    case "ping":
      conn.send({ t: "pong" });
      return;
    case "echo":
      conn.send({ t: "echo", text: msg.text });
      return;
    case "cmd":
      // Command handling lands in Phase 2 (accounts + world). Acknowledge for now.
      conn.send({
        t: "system",
        text: `commands arrive in Phase 2 — ignored: ${JSON.stringify(msg.raw)}`,
      });
      return;
  }
}
