/**
 * Live end-to-end smoke test (Phase 2): two accounts log in via Supabase, enter the world,
 * and verify they share a room and see each other's say/presence. Requires the server running
 * and the test users created (npm run make-users). Run from repo root: node server/scripts/smoke.mjs
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
      if (m.t === "auth_ok") return; // wait for char_list
      if (m.t === "char_list") {
        if (m.characters.length > 0) ws.send(JSON.stringify({ t: "char_select", characterId: m.characters[0].id }));
        else ws.send(JSON.stringify({ t: "char_create", name: createName, raceId: 15, classId: 3 })); // Ghoul Warrior
        return;
      }
      if (m.t === "entered") { entered = true; resolve({ ws, output, name: m.character.name }); return; }
      if (m.t === "output") for (const line of m.lines) output.push(line.map((s) => s.text).join(""));
      if ((m.t === "auth_error" || m.t === "error") && !entered) reject(new Error(m.message));
    });
    ws.on("error", reject);
  });
}

const send = (c, raw) => c.ws.send(JSON.stringify({ t: "cmd", raw }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); failures++; } else console.log("ok:", msg); };

try {
  const [t1, t2] = await Promise.all([
    login("tester1@hoggie.local", "ghoulish1"),
    login("tester2@hoggie.local", "ghoulish2"),
  ]);
  const c1 = await client(t1, "Smokeone");
  const c2 = await client(t2, "Smoketwo");
  console.log(`entered as ${c1.name} and ${c2.name}`);
  await wait(300);

  c1.output.length = 0;
  c2.output.length = 0;
  send(c1, "look");
  await wait(300);
  assert(c1.output.join("\n").includes(c2.name), `${c1.name} sees ${c2.name} on look (shared room)`);

  c2.output.length = 0;
  send(c1, "say greetings from the pit");
  await wait(300);
  assert(c2.output.join("\n").includes("says, 'greetings from the pit'"), `${c2.name} hears ${c1.name}'s say`);

  c2.output.length = 0;
  const exit = null;
  send(c1, "north");
  await wait(300);
  // whether or not north exists, c2 should either see a leave or nothing crash
  console.log("post-move c2 output:", JSON.stringify(c2.output));

  c1.ws.close();
  c2.ws.close();
} catch (err) {
  console.error("SMOKE ERROR:", err.message);
  failures++;
}

console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
