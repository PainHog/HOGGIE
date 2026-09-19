# House of Ghouls — Runbook

Everything needed to run the game locally from a clean checkout: install, environment,
database, the server, the visual client, accounts, admin, tests, and clean shutdown.

> **Secrets rule:** `.env` and `client/.env` are **gitignored** — they are *not* in the repo,
> so a fresh clone has none. You create them from the committed `*.example` files. Only ONE
> secret value is yours to supply (the Supabase **service_role** key); everything else is
> pre-filled or public. Never paste the service_role key into `client/.env` or into chat.

---

## 0. Prerequisites (install first)

- **Node.js 20 or newer** (22 recommended) and **npm** (bundled with Node).
  - Check: `node -v` (should print v20.x or newer).
- A **Supabase** project (Postgres + Auth). This repo is already wired to one — see §2.
- No other global tooling. The Expo client uses a locally-installed CLI (no `expo` global).

---

## 1. Get the code & install dependencies

```bash
git clone <your-repo-url> HOGGIE
cd HOGGIE

npm install                       # root workspaces: server + shared
cd client && npm install && cd .. # the Expo client is standalone (its own node_modules)
```

---

## 2. Environment variables

Create the two env files from the committed examples:

```bash
cp .env.example .env                 # server (repo root)
cp client/.env.example client/.env   # Expo client
```

### Server `.env` (repo root)

| Variable | Who supplies it | Notes |
|---|---|---|
| `PORT` | pre-filled (`4100`) | WebSocket port the server listens on. |
| `CONTENT_DIR` | optional | World JSON dir; defaults to `houseofghouls-export/content`. |
| `WORLD_AREAS` | optional | Comma-separated zone files to load. Default: `drazuni.are,drazpost.are`. |
| `START_ROOM` | optional | Spawn room vnum. Default `10300` (University Entrance). |
| `ADMIN_EMAILS` | **you** | Comma-separated emails auto-granted `admin` on login (see §6). |
| `SUPABASE_URL` | **pre-filled** | The project URL — already in `.env.example`. |
| `SUPABASE_ANON_KEY` | **pre-filled** | Publishable key (`sb_publishable_…`) — public, already in `.env.example`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **YOU (secret)** | The only value you must add. See below. |

### Client `client/.env`

| Variable | Who supplies it | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | pre-filled | Project URL (public). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | pre-filled | Publishable key (public — meant to ship in clients). |
| `EXPO_PUBLIC_WS_URL` | pre-filled (`ws://localhost:4100`) | The game server. Use your machine's LAN IP for a phone. |

### The one secret you supply — `SUPABASE_SERVICE_ROLE_KEY`

Goes in the **server** `.env` only (never the client).

1. Open the [Supabase dashboard](https://supabase.com/dashboard) → the **House of Ghouls**
   project (ref `yjjyocgxlsmnsxnyireu`).
2. Left sidebar → **Project Settings** (gear) → **API Keys**.
3. Copy the **secret** key (labelled `secret` / `sb_secret_…`; on older projects it is the
   `service_role` JWT under "Project API keys").
4. Paste it as the value of `SUPABASE_SERVICE_ROLE_KEY=` in the repo-root `.env`.

> Sandbox note: if your shell sets `HTTPS_PROXY`, the server auto-routes outbound HTTPS
> through it — nothing to configure.

---

## 3. Database (one-time)

The `characters`/`accounts` tables come from the SQL under `supabase/migrations/`, applied
in order:

```
0001_accounts_characters.sql   accounts + characters tables
0002_builder_scope.sql         builder vnum range on accounts
0003_dual_class.sql            characters.dual_class_id
0004_tier.sql                  characters.tier, tier_exp
0005_inventory.sql             characters.inventory (jsonb)
```

**If the project is already provisioned (this one is), skip this section.** For a brand-new
Supabase project, apply them once: dashboard → **SQL Editor** → paste each file's contents in
numeric order and **Run**. (Verify: dashboard → **Table Editor** shows `accounts` and
`characters`.)

---

## 4. Start the server

```bash
npm run dev     # tsx watch (auto-reload) on ws://localhost:4100
# or:
npm start       # one-shot, no watch
```

A healthy boot logs, in order: `server booting` → `world loaded from content`
(areas/rooms/mobs/objects) → `world populated from resets` (mobs spawned) →
`Supabase reachable` → `ws listening` → `House of Ghouls is live on ws://localhost:4100`.

> The default `WORLD_AREAS` loads the **Drazukville slice** (`drazuni` school + `drazpost`
> town, ~337 rooms) — a self-contained, fully playable area with shops and mobs. Widen the
> world by adding zone files to `WORLD_AREAS` (see the zone files in
> `houseofghouls-export/content/areas.json`).

---

## 5. Start the client & open it

In a **second terminal**:

```bash
cd client
npm run web      # Metro bundles, then serves the web client
```

Open **http://localhost:8081** in your browser. (For a phone on the same network: run
`npm start`, set `EXPO_PUBLIC_WS_URL` to `ws://<your-LAN-IP>:4100`, and scan the QR in Expo Go.)

The client is a **visual 2D game**: a room scene with a compass (click a direction to walk),
clickable enemy tokens (tap to engage), a live-combat action bar (stance dial + flee), a vitals
HUD, an explored-room minimap, and Character / Inventory / Skills panels (hover any race, class,
stat, skill or item for its lore). The classic command line at the bottom still runs every text
command (`look`, `n/s/e/w`, `kill <mob>`, `score`, `slist [all]`, `buy`/`sell`/`list`,
`advancetier`, `who`, `help`, …). A **Credits** screen lists the game-icons.net artists
(see `client/ASSETS.md`).

---

## 6. Create an account, log in, become admin

### Create an account + log in

Two ways:

- **Test accounts (fastest, no email needed):**
  ```bash
  npm run make-users      # creates two confirmed accounts (idempotent)
  ```
  Then sign in with `tester1@hoggie.local` / `ghoulish1` (or `tester2` / `ghoulish2`).

- **Your own account:** on the client sign-in screen, enter an email + password and click
  **Create account**. (If your Supabase project has email confirmation enabled, confirm via
  the emailed link before signing in; the test-account route above avoids that.)

After sign-in: choose a race + class (+ optional dual class) → **Enter the world**.

### Make yourself an admin

1. Put your sign-in email in `ADMIN_EMAILS` in the server `.env`
   (e.g. `ADMIN_EMAILS=you@example.com`).
2. Restart the server (`Ctrl-C`, then `npm run dev`).
3. Log in — you are granted the `admin` role automatically on login.

Admins can then, from the in-game command line:
`grant <email> <role>` (`player`/`builder`/`moderator`/`admin`) and
`setbuilder <email> <lowVnum> <highVnum>` to scope a builder.

---

## 7. Tests & checks

```bash
npm test                        # server unit suite (vitest) — 64 tests
npm run typecheck               # server + shared typecheck (tsc, no emit)
cd client && npx tsc --noEmit && cd ..   # client typecheck
```

Optional end-to-end smoke scripts (need the server running + `npm run make-users` first):

```bash
node server/scripts/smoke.mjs                              # movement + presence
TARGET_KEYWORD=scaly node server/scripts/smoke-combat.mjs  # two players kill a mob
node server/scripts/smoke-staff.mjs                        # role/capability gating
```

---

## 8. Stop everything cleanly

- In each terminal, press **Ctrl-C** (the server handles SIGINT/SIGTERM and shuts down cleanly).
- If you backgrounded a process, find and stop it:
  ```bash
  pkill -f "tsx .*src/index.ts"   # the game server
  pkill -f "expo start"            # the client bundler
  ```
- Nothing to clean up on disk: the world is in-memory and content JSON is read-only; player and
  account state lives in Supabase.

---

## Layout reminder

```
server/   the live game (Node/TS, WebSocket, in-memory world)
shared/   wire-protocol types
client/   Expo app (web + mobile)
supabase/ SQL migrations
houseofghouls-export/  extracted content JSON + Step 1 specs (the world seed + design)
```
