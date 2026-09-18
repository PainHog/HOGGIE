# House of Ghouls — Architecture Plan (Step 1D)

A concrete build for the target stack: a **Node.js + TypeScript authoritative game server** that
holds the live world in memory and is the single source of truth, **Supabase (Postgres + Auth)**
as the persistence/accounts layer behind it, and an **Expo** client (web first, mobile later).
This plan is grounded in what Step 1 actually found: 99 areas / 8,487 rooms / 3,772 mobs /
2,798 objects, 16 classes, 24 races, 559 skills, and the custom systems in `systems-spec.md`.

> Scope note: this is the **plan to review**. No engine code is written yet — that waits for
> your sign-off, per the Step 1 instructions.

---

## 1. Shape of the system

```
   Expo client (web/iOS/Android)         ← rich text client: input, scroll, panels
        │  WebSocket (JSON messages)      ← live game traffic
        ▼
   Node/TS Game Server  ◄── THE live game ──►  holds world in memory (rooms, who's here,
        │                                        combat, movement); runs the tick loop
        │  Postgres (SQL) + Auth
        ▼
   Supabase  ← accounts, characters, items, world save-state, content tables, roles
```

**Hard rule (from the brief):** the live real-time game runs **in the Node server's memory**,
not through Supabase realtime. Supabase is the database and auth the server reads at boot and
writes back to on save. Players connect to the **Node server over WebSockets**; the server
broadcasts room events to the sockets in each room.

### Why authoritative in-memory
The whole game — one shared persistent world, everyone present together, real-time combat, "you
see each other act" — depends on a single process owning the truth and ticking it. That is
exactly what the SMAUG engine did (one process, a game loop, the world in RAM); we keep that
model and modernize the language, transport, and persistence. Rooms, occupants, combat state,
and movement live in memory as plain TS objects/maps; Postgres is durability, not the live loop.

---

## 2. The Node/TS server

### 2.1 Runtime & libraries
- **Node 20+ / TypeScript**, ESM.
- **WebSockets:** `ws` (bare and fast) with a thin JSON message protocol. (Socket.IO is an
  option if we want rooms/reconnection sugar, but `ws` keeps the protocol explicit.)
- **Supabase access from the server:** `@supabase/supabase-js` with the **service-role key**
  (server-side only) or a direct Postgres pool (`pg`) for hot paths and transactions.
- **Validation:** `zod` for every inbound client message.
- **Scheduling:** a single monotonic tick loop (`setInterval`/drift-corrected) — see §2.4.
- **Testing:** `vitest`; deterministic combat via a seedable RNG so fights are reproducible.

### 2.2 In-memory world model (mirrors the extracted content)
Loaded from the content tables at boot into maps keyed by vnum:

```ts
World {
  rooms:   Map<number, Room>          // 8,487
  mobProto:Map<number, MobPrototype>  // 3,772  (templates)
  objProto:Map<number, ObjPrototype>  // 2,798  (templates)
  areas:   Map<string, Area>          // 99
  classes: Map<number, ClassDef>      // 16
  races:   Map<number, RaceDef>       // 24
  skills:  Map<string, SkillDef>      // 559
}
Room { vnum, areaId, name, desc, sector, flags[], exits: Exit[],
       players: Set<Character>, mobs: MobInstance[], items: ObjInstance[] }
MobInstance / ObjInstance = live copies spun from a prototype vnum (resets create them)
Character { accountId, id, name, race, class, dualClass?, tier, level, stats{7},
            hp/mana/move, position(stance), room, inventory, equipment{slot→item}, ... }
```

Prototypes are immutable templates; **resets** (the 5,359 spawn records) instantiate live mobs
and objects into rooms on boot and on the 60s area-repop tick. This is a 1:1 conceptual match to
the extracted `resets.json` (`spawn_mob` with `max_in_world`, `equip_mob`, `give_to_mob`,
`place_object`, `put_in_container`).

### 2.3 Command pipeline
```
socket → decode+zod → resolve character → command dispatch(name, args) → mutate world
       → collect events → broadcast to affected room/players → persist if needed
```
Commands are small handlers (`move`, `look`, `get`, `wear`, `kill`, `cast`, `say`, `recall`, …),
each declaring a required **capability** (not a magic level — see §5). The dispatcher mirrors the
old command table but replaces "level ≥ N" with named capabilities.

### 2.4 The tick loop (from `systems-spec.md` §Foundational)
One loop at 10 Hz driving staggered pulses:
- **combat** every 2s — each fighting character takes its attacks (§combat model),
- **mob AI** every 3s — wandering, aggro, mudprog-equivalent behaviors,
- **regen** every 7s + world tick 60s — position/stat-based HP/mana/move,
- **area repop** every 60s — re-run resets to top up spawns,
- **weather/time** on the 60s tick.

Combat resolution, the fighting-stance multipliers, ascending to-hit, RIS, multi-attacks, XP,
and saving throws are ported **as behavior** from the spec — reimplemented fresh in TS.

### 2.5 Scripting (mob/obj/room programs)
774 mobs + 64 rooms carry SMAUG mudprogs (triggers like `death_prog`, `rand_prog`, `speech`,
`greet`). Two-phase plan:
- **v1:** a small typed **trigger system** (`onDeath`, `onRandom`, `onGreet`, `onSpeech`, …)
  hand-authored for the slice's key NPCs. The mudprog *bodies* are simple command lists — easy
  to translate.
- **later:** a data-driven trigger runtime (optionally embedded JS via `isolated-vm`, or a tiny
  DSL) so builders script content without server redeploys. The old Lua layer's *behavior* is a
  reference; the code isn't carried.

### 2.6 Persistence strategy
- **Boot:** load content tables into memory (read-mostly).
- **Live:** all gameplay mutates memory. Player-affecting state (characters, inventory, gold,
  bank, quest/glory, skills) is **write-behind** to Postgres — on meaningful events (level,
  save command, logout) and on a periodic flush — so a crash loses seconds, not sessions.
- **World save-state:** area economy pools, door states, and any persistent world changes flush
  on the world tick. (Live mob/obj instances are ephemeral — recreated from resets — so they
  don't need saving unless we later add persistent housing/lockers.)
- **Hot-reboot:** keep sockets alive across a content reload where possible (the old engine's
  "hotboot"), otherwise a clean reconnect.

### 2.7 Scale / single-source-of-truth
One authoritative process for the whole shared world (this game's scale — tens to low-hundreds
concurrent — fits comfortably in one Node process). Horizontal sharding (area servers) is
explicitly **not** v1; if ever needed, shard by area with a gateway, but the faithful-classic
model wants one world. Postgres is the only shared durable store.

---

## 3. Supabase schema (persistence + accounts)

Two logical groups: **content** (the world seed, largely read-only at runtime) and **state**
(accounts, characters, live-savable data). Row-Level Security protects player data; the **game
server uses the service role** and is the only writer of gameplay state.

### 3.1 Content tables (seeded from `content/*.json`)
```
areas(id pk, file, name, author, version, level_low, level_high, flags jsonb, reset_msg)
rooms(vnum pk, area_id fk, name, description, sector, room_flags jsonb, exits jsonb, extra jsonb)
mob_prototypes(vnum pk, area_id fk, keywords, short_desc, long_desc, description,
               level, act_flags jsonb, affect_flags jsonb, alignment, thac0, ac,
               hp_dice, dam_dice, gold, exp, position, sex, stats jsonb, saves jsonb,
               race_id, class_id, special_attacks jsonb, special_defenses jsonb, has_progs bool)
obj_prototypes(vnum pk, area_id fk, keywords, short_desc, description, item_type,
               extra_flags jsonb, wear_flags jsonb, values jsonb, weight, cost,
               spells jsonb, affects jsonb)
resets(id pk, area_id fk, kind, mob_vnum, obj_vnum, room_vnum, container_vnum,
       wear_loc, max_in_world, ordinal)
classes(id pk, name, attrs jsonb, thac0_base, thac0_mod, hp_min, hp_max, mana_gain,
        exp_base, skill_adept_cap, skills jsonb, titles jsonb)
races(id pk, name, stat_mods jsonb, resist jsonb, immune jsonb, language, align_min,
      align_max, exp_mult, size jsonb, allowed_classes jsonb)
skills(id pk, name, type, slot, mana, min_level, min_position, target, damage_noun,
       flags, handler_key)   -- handler_key maps to a TS implementation, not old C
```
A one-time **seeder** loads the Step 1A JSON straight into these (the JSON already matches this
shape). `handler_key` lets each spell/skill bind to a fresh TS function.

### 3.2 State tables
```
accounts(id pk = supabase auth uid, email, created_at, roles jsonb, banned bool)
characters(id pk, account_id fk, name unique, race_id, class_id, dualclass_id,
           tier int, level, exp, alignment, stats jsonb, hp, mana, move, gold,
           bank_balance, quest_points, pkills, practices, room_vnum, title,
           conditions jsonb, created_at, last_played, playtime, deleted bool)
character_skills(character_id fk, skill_id fk, percent, pk(character_id, skill_id))
character_items(id pk, character_id fk, proto_vnum, wear_slot null|slot,
                container_id null|fk, condition, timer, affects_override jsonb, ...)
world_state(key pk, value jsonb)          -- e.g. area economy pools, door states, time
bans(id pk, kind[site|race|class|account], value, level, expires_at, by, reason)
audit_log(id pk, actor_account, action, target, detail jsonb, at)  -- staff actions
```
- **Area economy pools** live in `world_state` (or a dedicated `area_economy` table), flushed on
  the world tick — this preserves the custom finite-regional-wealth model from the spec.
- **Characters-per-account is many-to-one** (unlike the old one-char-per-login), which the
  modern account/role system wants.

### 3.3 RLS & access
- Players (via the client) **never** talk to Postgres directly for gameplay — they talk to the
  Node server. The client uses Supabase **only for auth** (sign-in) and maybe read-only profile
  views.
- RLS: an account can read its own `characters`/`character_items`; only the **service role**
  (the game server) writes gameplay state. Staff tools go through the server too, gated by roles
  and written to `audit_log`.

---

## 4. Real-time / WebSocket protocol (faithful-classic shared world)

- **Transport:** one WebSocket per connected player. JSON messages both ways.
- **Client → server:** `{t:"cmd", raw:"kill rooster"}` (parsed server-side, like a MUD command
  line) plus structured UI actions `{t:"move", dir:"north"}`, `{t:"wear", item:...}` for panel
  buttons. Everything is validated and authorized server-side; the client is never trusted.
- **Server → client:** typed events — `room` (full room state on entry: title, desc, exits,
  occupants, items), `output` (scrolling narrative lines with color spans), `vitals`
  (hp/mana/move/xp deltas), `panel` updates (inventory, equipment, group, who's-here), and
  `combat` ticks. A room broadcast fans a single event out to the `Set<socket>` in that room, so
  everyone "sees each other act" in real time.
- **Presence:** the server tracks who is in each room in memory; entering/leaving a room emits
  arrival/departure events to the room. This is the classic "players see each other" behavior,
  driven by the authoritative server rather than Supabase realtime.
- **Color:** the legacy content is full of `&`-codes (ANSI-ish color). The server translates
  those to structured spans the Expo client styles — no raw ANSI to the client.
- **Reconnect:** character stays in-world briefly on disconnect (link-dead), reattaches on
  reconnect — matching MUD convention and mobile network reality.

---

## 5. Permission system (player / builder / moderator / admin)

Replaces the old "level ≥ N + trust + bestowments" with **explicit named capabilities** mapped
to roles (from `systems-spec.md` §5).

- **Roles** on the account: `player`, `builder`, `moderator`, `admin` (stored in
  `accounts.roles`, can hold several).
- **Capabilities** are fine-grained (`world.goto`, `world.load_mob`, `build.redit`,
  `mod.ban`, `mod.freeze`, `admin.reboot`, `admin.grant_role`, …). Each command declares the
  capability it needs; the dispatcher checks the actor's role→capability set. This preserves the
  old per-command gating and the bestowment overlay (grant an individual capability to one
  account) without a magic integer.
- **Builder sandboxing carries over directly:** a `builder` is assigned area(s) and constrained
  to those areas' **vnum ranges** (the old model already worked this way). Builder edits touch
  only prototypes within their allotment; live OLC writes go to the content tables + memory.
- **Moderator:** ban/deny/freeze/silence/disconnect/snoop/watch, all written to `audit_log`.
- **Admin:** role grants, server control, economy resets, full world control.
- The four in-game **immortal ranks** (Implementor/God/etc.) become **titles/flavor**, decoupled
  from actual power — power is the role/capability set.

---

## 6. Expo client (web first, mobile later)

- **Expo + React Native (web target first)**, TypeScript, one codebase → web/iOS/Android.
- **Layout:** a MUD-style rich text client, not a form:
  - **Main output pane** — scrolling narrative with color spans, room descriptions, combat.
  - **Command input** — text line (classic), with autocomplete + a command history; on mobile,
    quick-action buttons and a movement compass.
  - **Panels** (collapsible, responsive): **Character** (vitals, stats, xp/tnl, stance),
    **Inventory/Equipment** (with wear slots), **Room** (exits + who/what is here),
    **Group/Who** (players present). Panels update from the server's typed events, so they stay
    in sync with the narrative.
- **State/transport:** a small WS client with typed event handling; `zustand`/Redux for UI
  state. Auth via `@supabase/supabase-js` (email/OAuth) → the client gets a session, opens the
  WS to the game server, and authenticates the socket with the Supabase JWT (server verifies).
- **Theming:** map legacy `&`-color codes to a themeable palette; readable on phone and desktop.

---

## 7. v1 vertical slice — playable end-to-end, 2+ players in a shared room

**Goal:** prove the whole spine — account → character → shared world → real-time combat →
progression → inventory → persistence — on a **small, hand-picked chunk of the real world**,
before widening to all 99 areas.

### 7.1 Zones (already the natural starter cluster)
- **University of Alden** (`drazuni.are`, vnums 10300–10499, **153 rooms**, level 1–5) — the
  **newbie school**; the player logs show **room 10300 is the actual starting/recall point for
  new characters**. This is the tutorial/starting zone.
- **Drazukville** (`drazville.are`, vnums 21001–21500, **172 rooms**) — the **central hub city**
  and the **recall temple is room 21001**. Shops, bank, healer, pit, temple — the town every
  player returns to.
- Connect them with a short road (a handful of `southroad`/`greenpath` rooms) so the slice has
  travel between school and town. This gives ~350 curated rooms with the game's real soul intact.

Both are **Drazuk-authored originals** (clean IP per `audit.md`), and Drazukville exercises the
most systems (shops, bank, healer, questmaster, mudprog NPCs like Jerald the Pitboy).

### 7.2 Systems in the slice
- **Movement & world:** rooms, exits/doors, sectors, look, who's-here, real-time presence.
- **Combat:** the full model — 2s rounds, fighting stances, ascending to-hit, damage + RIS,
  multi-attacks, death → corpse → respawn at temple 21001. **Two players in one room fighting a
  mob and seeing each other's actions** is the acceptance test.
- **Progression:** exp per kill, TNL curve, level-up gains, a starter subset of skills/spells
  (a few per starting class) with learn-by-use.
- **Classes/races:** ship maybe **3 classes** (Warrior, Mage, Cleric) and **3 races**
  (Human, Ghoul, Elf) for the slice, from the extracted defs; widen after.
- **Inventory/economy:** get/drop/wear/wield, one shop + the healer + the bank in Drazukville,
  the **area-economy pool** behavior, `identify`.
- **Chat/social:** say/tell/emote so multiplayer feels alive.
- **Accounts/roles:** Supabase auth, create/select character, and an **admin** account that can
  `goto`/`load`/`restore` to test staff tooling.

### 7.3 Explicitly deferred past v1
Full 99-area world load, tier/remort, dual-class, clans/councils/deity, the full 559-skill set,
mounts, quests beyond a single test quest, the data-driven scripting runtime, and mobile-native
polish. All are on the roadmap; none block proving the slice.

### 7.4 Milestones
1. **Server skeleton** — WS accept, auth handshake, command dispatch, in-memory World loaded
   from a seeded slice; `look`/`move`/`say` for 2 connected players.
2. **Content pipeline** — Supabase content tables + seeder from `content/*.json`; load the two
   zones + their resets into memory.
3. **Combat + progression** — the tick loop, stances, to-hit/damage/RIS, death/respawn, xp/level.
4. **Items + economy** — inventory, wear/wield, shop/bank/healer, area pool, identify.
5. **Client** — Expo panels + output + input wired to the WS events.
6. **Persistence + roles** — write-behind saves, account/character tables, RLS, admin commands.
7. **Playtest** — 2+ players, shared room, full loop; then widen zones.

---

## 8. Content migration path (from Step 1A to the server)

1. Seed Supabase **content tables** directly from `content/*.json` (shapes already align — §3.1).
2. At server boot, load those tables into the in-memory `World` maps.
3. Instantiate the slice via `resets.json` (spawn/equip/give/place).
4. Bind each `skills.json` entry's `handler_key` to a fresh TS implementation as skills are
   built (start with the slice's subset).
5. Translate the slice NPCs' mudprogs into typed triggers (§2.5).
6. Widen zone-by-zone: the remaining 97 areas load through the same pipeline with no new code —
   just data — once the slice is proven.

## 9. Open questions for you

- **Player continuity:** carry forward existing pfiles/characters, or fresh start on the new
  engine? (Old auth is one-char-per-login with `crypt()` passwords; a clean cutover to Supabase
  accounts is simplest — migrating live characters is possible but extra work.)
- **Tier/remort & dual-class in v1 or roadmap?** (Recommend roadmap; they're endgame.)
- **How faithful on the numbers?** Reproduce the exact formulas from `systems-spec.md`, or treat
  them as a starting point to rebalance on the modern engine?
- **Scripting appetite:** typed triggers only (safer) vs. a builder-facing scripting runtime
  (more powerful) — affects how much of the 774 mudprog NPCs we carry early.
