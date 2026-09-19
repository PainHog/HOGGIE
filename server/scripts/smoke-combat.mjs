/**
 * Live combat smoke (Phase 3): two players in one room both attack a mob, see each other's
 * blows, and the mob dies with xp awarded. Boot the server with START_ROOM set to a room that
 * has a mob, e.g.:
 *   START_ROOM=21029 npx tsx server/src/index.ts &
 *   node server/scripts/smoke-combat.mjs
 * (21029 is a Drazukville room with "a dirty rat".) Creates throwaway characters.
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
const TARGET = process.env.TARGET_KEYWORD || "rat";

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
      if (m.t === "char_list") {
        ws.send(JSON.stringify({ t: "char_create", name: createName, raceId: 15, classId: 3 }));
      } else if (m.t === "entered") {
        entered = true;
        resolve({ ws, output, name: m.character.name, roomVnum: null });
      } else if (m.t === "output") {
        for (const line of m.lines) output.push(line.map((s) => s.text).join(""));
      } else if (m.t === "room") {
        // remember what's here
      } else if ((m.t === "auth_error" || m.t === "error") && !entered) {
        reject(new Error(m.message));
      }
    });
    ws.on("error", reject);
  });
}

const send = (c, raw) => c.ws.send(JSON.stringify({ t: "cmd", raw }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); failures++; } else console.log("ok:", msg); };

try {
  const rl = () => Array.from({length:6},()=>String.fromCharCode(97+Math.floor(Math.random()*26))).join('');
  const [t1, t2] = await Promise.all([
    login("tester1@hoggie.local", "ghoulish1"),
    login("tester2@hoggie.local", "ghoulish2"),
  ]);
  const c1 = await client(t1, 'Ka'+rl());
  const c2 = await client(t2, 'Zo'+rl());
  console.log(`entered as ${c1.name} and ${c2.name}`);
  await wait(300);

  // confirm shared room shows the mob
  c1.output.length = 0;
  send(c1, "look");
  await wait(300);
  const roomText = c1.output.join("\n").toLowerCase();
  assert(roomText.includes(c2.name.toLowerCase()), `${c1.name} shares the room with ${c2.name}`);
  assert(roomText.includes(TARGET), `a '${TARGET}' is in the room to fight`);

  // both attack
  c1.output.length = 0;
  c2.output.length = 0;
  send(c1, "kill " + TARGET);
  send(c2, "kill " + TARGET);

  // let combat rounds run (2s ticks)
  await wait(12000);

  const o1 = c1.output.join("\n");
  const o2 = c2.output.join("\n");
  assert(/you (hit|scratch|injure|wound|maul|miss)/i.test(o1), `${c1.name} strikes at the ${TARGET}`);
  assert(o2.includes(c1.name), `${c2.name} sees ${c1.name} in the fight (shared combat)`);
  assert(/is DEAD/i.test(o1 + o2), `the ${TARGET} died`);
  assert(/experience points/i.test(o1 + o2), "someone gained experience");

  c1.ws.close();
  c2.ws.close();
} catch (err) {
  console.error("SMOKE ERROR:", err.message);
  failures++;
}

console.log(failures === 0 ? "\nCOMBAT SMOKE PASSED" : `\nCOMBAT SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
