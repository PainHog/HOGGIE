import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startWsServer, type WsHandle } from "./wsServer.ts";
import type { ServerMessage } from "@hoggie/shared";

let server: WsHandle;

beforeAll(async () => {
  server = await startWsServer({ port: 0 }); // ephemeral port
});

afterAll(async () => {
  await server.close();
});

/** Open a socket and collect the next `count` decoded server messages. */
function collect(count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    const got: ServerMessage[] = [];
    const timer = setTimeout(() => reject(new Error("timeout")), 3000);
    ws.on("message", (data) => {
      got.push(JSON.parse(data.toString()) as ServerMessage);
      if (got.length >= count) {
        clearTimeout(timer);
        ws.close();
        resolve(got);
      }
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "echo", text: "hello world" }));
    });
    ws.on("error", reject);
  });
}

describe("ws server (Phase 1 connect/echo)", () => {
  it("sends a welcome then echoes back", async () => {
    const [welcome, echo] = await collect(2);
    expect(welcome).toMatchObject({ t: "welcome", server: "House of Ghouls" });
    expect(echo).toEqual({ t: "echo", text: "hello world" });
  });

  it("answers ping with pong", async () => {
    const reply = await new Promise<ServerMessage>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server.port}`);
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      let sawWelcome = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (!sawWelcome) {
          sawWelcome = true;
          ws.send(JSON.stringify({ t: "ping" }));
          return;
        }
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      });
      ws.on("error", reject);
    });
    expect(reply).toEqual({ t: "pong" });
  });

  it("rejects malformed input with an error", async () => {
    const reply = await new Promise<ServerMessage>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server.port}`);
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      let sawWelcome = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (!sawWelcome) {
          sawWelcome = true;
          ws.send("this is not json");
          return;
        }
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      });
      ws.on("error", reject);
    });
    expect(reply.t).toBe("error");
  });
});
