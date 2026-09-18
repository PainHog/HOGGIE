/** Thin WebSocket client to the game server. The live game is this socket, not Supabase. */
import { CONFIG } from "./config";
import type { ClientMessage, ServerMessage } from "./protocol";

export class GameConnection {
  private ws: WebSocket | null = null;

  constructor(
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onClose: () => void,
  ) {}

  connect(token: string): void {
    const ws = new WebSocket(CONFIG.wsUrl);
    this.ws = ws;
    ws.onopen = () => this.send({ t: "auth", token });
    ws.onmessage = (e: MessageEvent) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => this.onClose();
    ws.onerror = () => {
      /* onclose will follow */
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  cmd(raw: string): void {
    this.send({ t: "cmd", raw });
  }

  close(): void {
    this.ws?.close();
  }
}
