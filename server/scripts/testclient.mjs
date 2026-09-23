/**
 * Interactive auth + play test client (Phase 2). Not the real UI (that's the Expo client in
 * Phase 4) — just enough to log in, create/select a character, and move around so two people
 * can see each other in a shared room.
 *
 * Run from the repo root:
 *   TEST_EMAIL=tester1@hoggie.local TEST_PASSWORD=ghoulish1 npm run test-client
 *
 * In-client meta commands:
 *   /list                       list your characters
 *   /create <name> <race> <class>   e.g. /create Grimfang Ghoul Warrior
 *   /select <n>                 select character number n from the last list
 *   /quit                       disconnect
 * Anything else is sent to the game as a command (look, north, say hi, who, score…).
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import { WebSocket } from "ws";
import { createInterface } from "node:readline";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const WS_URL = process.argv[2] ?? "ws://localhost:4100";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

// v1 playable race/class name -> content id (from race.lst / class.lst order).
const RACE_ID = { human: 0, elf: 1, ghoul: 15 };
const CLASS_ID = { mage: 0, cleric: 1, warrior: 3 };

const ANSI = {
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[97m", gray: "\x1b[90m",
};
const RESET = "\x1b[0m";
const renderLine = (spans) =>
  spans.map((s) => (s.color && ANSI[s.color] ? ANSI[s.color] + s.text + RESET : s.text)).join("");

async function login() {
  if (!EMAIL || !PASSWORD) {
    console.error("Set TEST_EMAIL and TEST_PASSWORD (run: node server/scripts/make-test-users.mjs)");
    process.exit(1);
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("login failed:", body.error_description || body.msg || JSON.stringify(body));
    process.exit(1);
  }
  return body.access_token;
}

const token = await login();
console.log(`logged in as ${EMAIL}`);

const ws = new WebSocket(WS_URL);
let characters = [];
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "auth", token }));
});

ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  switch (m.t) {
    case "welcome": break;
    case "auth_ok": console.log(`\n[authed: ${m.email}]`); break;
    case "auth_error": console.log(`\n[auth error] ${m.message}`); break;
    case "char_list":
      characters = m.characters;
      if (characters.length === 0) console.log("\nNo characters. /create <name> <race> <class>  (races: Human Elf Ghoul; classes: Warrior Mage Cleric)");
      else {
        console.log("\nYour characters:");
        characters.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} — L${c.level} ${c.race} ${c.className}`));
        console.log("/select <n> to play");
      }
      break;
    case "entered": console.log(`\n=== Entered as ${m.character.name} ===`); break;
    case "output": for (const line of m.lines) console.log(renderLine(line)); break;
    case "room": console.log(`\x1b[36m[${m.room.name}]  exits: ${m.room.exits.join(" ") || "none"}${m.room.players.length ? "  here: " + m.room.players.join(", ") : ""}\x1b[0m`); break;
    case "vitals": console.log(`\x1b[90mHP ${m.vitals.hp}/${m.vitals.maxHp}  Mana ${m.vitals.mana}/${m.vitals.maxMana}  Move ${m.vitals.move}/${m.vitals.maxMove}  (${m.vitals.race} ${m.vitals.className} L${m.vitals.level})\x1b[0m`); break;
    case "system": console.log(`[system] ${m.text}`); break;
    case "error": console.log(`[error] ${m.message}`); break;
    default: console.log("<<", m);
  }
  rl.prompt();
});

ws.on("close", () => { console.log("connection closed"); process.exit(0); });
ws.on("error", (e) => { console.error("socket error:", e.message); process.exit(1); });

rl.on("line", (line) => {
  const text = line.trim();
  if (!text) { rl.prompt(); return; }
  if (ws.readyState !== WebSocket.OPEN) { rl.prompt(); return; }

  if (text === "/list") { ws.send(JSON.stringify({ t: "char_list" })); return; }
  if (text === "/quit") { ws.close(); return; }
  if (text.startsWith("/create ")) {
    const [, name, race, cls] = text.split(/\s+/);
    const raceId = RACE_ID[(race || "").toLowerCase()];
    const classId = CLASS_ID[(cls || "").toLowerCase()];
    if (raceId === undefined || classId === undefined) { console.log("usage: /create <name> <Human|Elf|Ghoul> <Warrior|Mage|Cleric>"); rl.prompt(); return; }
    ws.send(JSON.stringify({ t: "char_create", name, raceId, classId }));
    return;
  }
  if (text.startsWith("/select ")) {
    const n = parseInt(text.split(/\s+/)[1], 10);
    const c = characters[n - 1];
    if (!c) { console.log("no such character number"); rl.prompt(); return; }
    ws.send(JSON.stringify({ t: "char_select", characterId: c.id }));
    return;
  }
  ws.send(JSON.stringify({ t: "cmd", raw: text }));
});

rl.on("close", () => ws.close());
