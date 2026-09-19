/**
 * Live staff/roles smoke (Phase 5): boot the server with
 *   ADMIN_EMAILS=tester1@hoggie.local npx tsx server/src/index.ts &
 * tester1 becomes admin on login; tester2 stays a mortal. Verifies capability gating.
 * Run: node server/scripts/smoke-staff.mjs
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import { WebSocket } from "ws";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

const SUPA_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const WS = "ws://localhost:4100";

async function login(email, password) {
  const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const b = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${b.error_description || JSON.stringify(b)}`);
  return b.access_token;
}

function client(token, createName) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const output = [];
    let entered = false;
    ws.on("open", () => ws.send(JSON.stringify({ t: "auth", token })));
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === "char_list") ws.send(JSON.stringify({ t: "char_create", name: createName, raceId: 15, classId: 3 }));
      else if (m.t === "entered") { entered = true; resolve({ ws, output, name: m.character.name }); }
      else if (m.t === "output") for (const line of m.lines) output.push(line.map((s) => s.text).join(""));
      else if ((m.t === "auth_error" || m.t === "error") && !entered) reject(new Error(m.message));
    });
    ws.on("error", reject);
  });
}
const send = (c, raw) => c.ws.send(JSON.stringify({ t: "cmd", raw }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); failures++; } else console.log("ok:", msg); };

try {
  const [t1, t2] = await Promise.all([
    login("tester1@hoggie.local", "ghoulish1"),
    login("tester2@hoggie.local", "ghoulish2"),
  ]);
  const admin = await client(t1, "Ad" + rl());
  const mortal = await client(t2, "Mo" + rl());
  await wait(300);

  admin.output.length = 0;
  send(admin, "roles");
  await wait(300);
  assert(/admin/i.test(admin.output.join("\n")), "tester1 was bootstrapped to admin");

  admin.output.length = 0;
  send(admin, "goto 21001");
  await wait(400);
  assert(/teleport to room 21001/i.test(admin.output.join("\n")), "admin can goto");

  admin.output.length = 0;
  send(admin, "users");
  await wait(400);
  assert(/Users online/i.test(admin.output.join("\n")), "admin can list users");

  admin.output.length = 0;
  send(admin, "stat room");
  await wait(400);
  assert(/\[Room 21001\]/i.test(admin.output.join("\n")), "admin can stat the room");

  mortal.output.length = 0;
  send(mortal, "goto 21001");
  await wait(400);
  assert(/lack the authority/i.test(mortal.output.join("\n")), "mortal is denied goto");

  admin.ws.close();
  mortal.ws.close();
} catch (err) {
  console.error("SMOKE ERROR:", err.message);
  failures++;
}
console.log(failures === 0 ? "\nSTAFF SMOKE PASSED" : `\nSTAFF SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
