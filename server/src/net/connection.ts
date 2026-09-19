/** One connected socket. Phase 1 has no character attached yet — that comes in Phase 2. */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { encode, type ServerMessage } from "@hoggie/shared";

export class Connection {
  readonly id: string;
  readonly ws: WebSocket;
  /** ws-level heartbeat flag (see wsServer heartbeat). */
  isAlive = true;

  constructor(ws: WebSocket) {
    this.id = randomUUID();
    this.ws = ws;
  }

  send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(encode(msg));
    }
  }
}
