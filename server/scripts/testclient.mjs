/**
 * Tiny interactive WebSocket test client for Phase 1.
 *
 * Usage:  node server/scripts/testclient.mjs [ws://localhost:4100]
 *
 * Type a line and press enter -> it is sent as an `echo` message and the server's reply
 * is printed. Special inputs:  /ping  -> sends a ping,  /quit -> exits.
 * This exists only so you can see the connect/echo loop without the Expo client (Phase 4).
 */
import { WebSocket } from "ws";
import { createInterface } from "node:readline";

const url = process.argv[2] ?? "ws://localhost:4100";
const ws = new WebSocket(url);

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });

ws.on("open", () => {
  console.log(`connected to ${url}`);
  rl.prompt();
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log("<<", msg);
  } catch {
    console.log("<< (unparseable)", data.toString());
  }
  rl.prompt();
});

ws.on("close", () => {
  console.log("connection closed");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("socket error:", err.message);
  process.exit(1);
});

rl.on("line", (line) => {
  const text = line.trim();
  if (text === "/quit") {
    ws.close();
    return;
  }
  if (ws.readyState !== WebSocket.OPEN) {
    console.log("(not connected)");
    rl.prompt();
    return;
  }
  if (text === "/ping") {
    ws.send(JSON.stringify({ t: "ping" }));
    return;
  }
  ws.send(JSON.stringify({ t: "echo", text }));
});

rl.on("close", () => ws.close());
