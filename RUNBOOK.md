# House of Ghouls — Runbook

Operational guide for running the game locally: the server, the client, admin bootstrap,
tests, and the environment variables each side needs (**names only — never commit values;
real secrets live in gitignored `.env` files**).

## Prerequisites

- Node.js 20+ (22 recommended) and npm.
- A Supabase project (Postgres + Auth). The two SQL migrations under `supabase/migrations/`
  define the `accounts` and `characters` tables; apply them to your project once.

## 1. Configure environment

Two `.env` files, both gitignored. Copy the examples and fill them in.

```bash
cp .env.example .env               # server (repo root)
cp client/.env.example client/.env # Expo client
```

**Server `.env` (repo root) — variable names:**

| Variable | Purpose |
|---|---|
| `PORT` | WebSocket port the server listens on (default 4100). |
| `CONTENT_DIR` | Where the server reads the world JSON (defaults to `houseofghouls-export/content`). |
| `WORLD_AREAS` | Comma-separated area files to load into the world (data-driven; widen here, not in code). |
| `START_ROOM` | Room vnum new characters spawn into. |
| `ADMIN_EMAILS` | Comma-separated emails auto-granted the `admin` role on login (owner bootstrap). |
| `SUPABASE_URL` | Your Supabase project URL. |
| `SUPABASE_ANON_KEY` | Publishable/anon key (safe to expose; used for the auth reachability check). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Service-role key — the server is the only holder; never ship it to a client. |

**Client `client/.env` — variable names:**

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (public). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key (public — meant to ship in clients). |
| `EXPO_PUBLIC_WS_URL` | The game server WebSocket, e.g. the server's host:port. Use a LAN IP for a phone. |

> Sandbox note: if the process's outbound HTTPS is forced through a proxy (an `HTTPS_PROXY`
> is set in the environment), the server auto-routes through it — nothing to configure.

## 2. Install

```bash
npm install            # root workspaces: server + shared
cd client && npm install && cd ..   # the Expo app is standalone (its own node_modules)
```

## 3. Start the server

```bash
npm run dev            # tsx watch (auto-reload) on ws://localhost:$PORT
# or
npm start              # one-shot run
```

Boot logs report: world loaded (areas/rooms/mobs/objects/resets), Supabase reachability,
mobs spawned from resets, and the listening port.

## 4. Run the client (visual)

```bash
cd client
npm install            # first run only (installs react-native-svg, fonts, etc.)
npm run web            # opens the visual web client at http://localhost:8081
# npm start            # Expo Go on a phone (set EXPO_PUBLIC_WS_URL to your machine's LAN IP)
```

The client is a **visual 2D game** (Step 5): a room scene with clickable exits (a compass) and
clickable enemy tokens, live combat with animated health bars + floating damage + a stance dial +
flee, a vitals HUD, an explored-room minimap, and Character/Inventory panels. Sign in → create or
select a character → **tap an enemy to engage, tap a compass direction to walk.** The stance dial
(`berserk / aggressive / normal / defensive / evasive`) and `flee` are the live-combat controls;
auto-attacks resolve each round once engaged. The classic command line is kept at the bottom, so
every text command (`look`, `n s e w …`, `kill <mob>`, `rest`, `say`, `who`, `score`, `help`) still
works — including `slist [all]` (your class's skill/spell tree, unioned for dual-class) and
`advancetier` (remort at level 50, single-class, 500k gold → your tier class). A **Credits** screen (from the sign-in / character screens and the in-game toolbar) lists the
game-icons.net artists — see `client/ASSETS.md` for the full license breakdown.

> Tip — to land in a good Drazukville combat demo, start the server at the "scaly bartender" room:
> `START_ROOM=21164 npm run dev`. The bartenders are level 1 (killable at level 1); walk `west` into
> the Homer Street cluster to watch the minimap fill in.

Assets are all bundled locally and free (CC0 / OFL / CC BY 3.0-with-attribution). To change the
icon set, edit `client/scripts/gen-icons.mjs` and run `npm run gen:icons` (regenerates the icon
geometry + the Credits attribution list).

## 5. Create accounts & bootstrap an admin

```bash
npm run make-users     # dev only: creates two confirmed Supabase test accounts
```

To make yourself an admin: put your sign-in email in `ADMIN_EMAILS` in the server `.env`,
restart the server, and log in — you receive the `admin` role automatically. Admins can then
`grant <email> <role>` others (`player` / `builder` / `moderator` / `admin`) and
`setbuilder <email> <lowVnum> <highVnum>` to scope a builder.

## 6. Tests & checks

```bash
npm test               # vitest unit suite (server)
npm run typecheck      # TypeScript, no emit (server + shared)
cd client && npx tsc --noEmit   # client typecheck
```

End-to-end smoke scripts (require the server running + test users created):

```bash
node server/scripts/smoke.mjs                                 # movement + presence
START_ROOM=21164 npm start &                                  # start at a room with a mob
TARGET_KEYWORD=scaly node server/scripts/smoke-combat.mjs     # two players kill a mob together
ADMIN_EMAILS=you@example.com npm start &                      # admin bootstrap
node server/scripts/smoke-staff.mjs                           # role/capability gating
```

## 7. Stopping / cleanup

- Stop the server or client with Ctrl-C; the server shuts down cleanly on SIGINT/SIGTERM.
- The world is in-memory; player/account state persists in Supabase. Content is read-only JSON.

## Layout reminder

```
server/   the live game (Node/TS, WebSocket, in-memory world)
shared/   wire-protocol types
client/   Expo app (web + mobile)
supabase/ SQL migrations
houseofghouls-export/  extracted content JSON + Step 1 specs (the world seed + design)
```
