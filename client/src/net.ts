/** Thin WebSocket client to the game server. The live game is this socket, not Supabase. */
import { CONFIG } from "./config";
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol";
import { logDebug } from "./debug";

export class GameConnection {
  private ws: WebSocket | null = null;

  constructor(
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onClose: () => void,
  ) {}

  connect(token: string): void {
    logDebug("info", `connecting to ${CONFIG.wsUrl} (client protocol v${PROTOCOL_VERSION})`);
    const ws = new WebSocket(CONFIG.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      logDebug("info", "socket open — authenticating");
      this.send({ t: "auth", token });
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        if (msg.t === "welcome" && msg.protocol !== PROTOCOL_VERSION) {
          logDebug("error", `protocol mismatch: server v${msg.protocol} vs client v${PROTOCOL_VERSION} — reload the client`);
        }
        if (msg.t === "auth_error") logDebug("error", `auth failed: ${msg.message}`);
        if (msg.t === "error") logDebug("warn", `server error: ${msg.message}`);
        this.onMessage(msg);
      } catch (err) {
        logDebug("error", `bad frame from server: ${String(err)}`);
      }
    };
    ws.onclose = (e: CloseEvent) => {
      logDebug("warn", `socket closed (code ${e.code}${e.reason ? ` — ${e.reason}` : ""})`);
      this.onClose();
    };
    ws.onerror = () => {
      logDebug("error", `socket error connecting to ${CONFIG.wsUrl} — is the server running?`);
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

  /** Click-to-engage: ask the server to start a fight with this mob instance. */
  target(mobId: string): void {
    this.send({ t: "target", mobId });
  }

  close(): void {
    this.ws?.close();
  }
}
