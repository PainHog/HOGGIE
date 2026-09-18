# House of Ghouls — modern engine

A fresh, faithful-classic rewrite of the *House of Ghouls* MUD: one persistent shared world,
many players present in real time, classic MUD rhythm — modern engine and interface.

- **Node.js + TypeScript authoritative game server** — holds the live world in memory (rooms,
  presence, combat, movement) and is the single source of truth. Real-time over WebSockets.
- **Supabase (Postgres + Auth)** — persistence + accounts behind the server (not the live loop).
- **Expo client** (web first) — a rich text client. *(Phase 4.)*

The engine is written from scratch. Original world content (zones, mobs, items, classes,
skills) is loaded as data from [`houseofghouls-export/content/`](houseofghouls-export/content)
— the Step 1 extraction. No Diku/Merc/SMAUG engine code, stock content, or IP is carried in;
see [`houseofghouls-export/audit.md`](houseofghouls-export/audit.md).

## Layout

```
server/    Node/TS game server (the live game)
shared/    wire-protocol types shared by server + client
supabase/  SQL migrations                      (Phase 2)
client/    Expo app                            (Phase 4)
houseofghouls-export/   Step 1 extraction: content JSON + specs (the world seed + design)
HouseOfGhouls/          legacy source tree — reference only, NOT built or shipped
```

## Setup

```bash
npm install
cp .env.example .env        # then paste your Supabase service_role key into .env
```

`.env` is gitignored. The `SUPABASE_URL` and publishable key are already filled in
`.env.example`; the `service_role` key is a secret you add yourself.

## Run

```bash
npm run dev            # start the server (ws://localhost:4100)
npm test               # unit tests
npm run typecheck      # TypeScript, no emit
```

### Play (Phase 2)

```bash
npm run make-users     # one-time: create two confirmed Supabase test accounts

# in two more terminals, log in as each tester and share a room:
TEST_EMAIL=tester1@hoggie.local TEST_PASSWORD=ghoulish1 npm run test-client
TEST_EMAIL=tester2@hoggie.local TEST_PASSWORD=ghoulish2 npm run test-client
```

In the client: `/create <name> <race> <class>` (races: Human/Elf/Ghoul, classes:
Warrior/Mage/Cleric) or `/select <n>`, then play with `look`, `north`/`n` etc., `say hi`,
`who`, `score`, `quit`. Two logged-in players in the same room see each other move and talk.

`node server/scripts/smoke.mjs` runs an automated two-client end-to-end check.

The world is loaded from `content/` JSON at boot — widen it by adding area filenames to
`WORLD_AREAS` in `.env`, no code change. New characters start in `START_ROOM` (default 10300,
the University of Alden).

## Build phases

1. Server foundation — WS server, Supabase wiring, in-memory world model, connect/echo. ✓
2. **Accounts + world** — auth, character creation, load zones, movement, presence. ← current
3. Combat identity — stances, ascending-hit/RIS/PLUS damage, 2s round, position regen, LCK.
4. Expo client — the real text client.
5. Roles — player/builder/moderator/admin + builder area/vnum sandbox.
