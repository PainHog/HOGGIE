/**
 * WebSocket game server — the front door.
 *
 * Accepts sockets, sends a `welcome`, validates every inbound frame, and routes it to a
 * per-connection handler (a game Session in production). The server itself stays decoupled
 * from game logic via the `createHandler` factory, which also keeps it unit-testable.
 */
import { WebSocketServer, type WebSocket } from "ws";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
} from "@hoggie/shared";
import { log } from "../log.ts";
import { Connection } from "./connection.ts";

const SERVER_NAME = "House of Ghouls";
const HEARTBEAT_MS = 30_000;

export interface ConnectionHandler {
  handle(msg: ClientMessage): void | Promise<void>;
  onClose(): void | Promise<void>;
}

export interface WsServerOptions {
  port: number;
  createHandler: (conn: Connection) => ConnectionHandler;
}

export interface WsHandle {
  port: number;
  connectionCount(): number;
  close(): Promise<void>;
}

export function startWsServer(opts: WsServerOptions): Promise<WsHandle> {
  const wss = new WebSocketServer({ port: opts.port });
  const connections = new Map<string, Connection>();

  wss.on("connection", (ws: WebSocket) => {
    const conn = new Connection(ws);
    connections.set(conn.id, conn);
    const handler = opts.createHandler(conn);
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
      Promise.resolve(handler.handle(msg)).catch((err) => {
        log.error("handler error", { id: conn.id, err: String(err) });
        conn.send({ t: "error", message: "internal error" });
      });
    });

    ws.on("close", () => {
      connections.delete(conn.id);
      Promise.resolve(handler.onClose()).catch((err) =>
        log.warn("onClose error", { id: conn.id, err: String(err) }),
      );
      log.info("connection closed", { id: conn.id, total: connections.size });
    });

    ws.on("error", (err) => {
      log.warn("socket error", { id: conn.id, err: String(err) });
    });
  });

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
      log.info("ws listening", { name: SERVER_NAME, port });
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
