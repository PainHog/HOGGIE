# House of Ghouls — Step 1 export

Read-only extraction, documentation, audit, and plan for modernizing *House of Ghouls* (a
SMAUG-derived MUD with ~10 years of original content) into a Node/TS + Supabase + Expo game.
**No engine code was written or copied.** This is the material to review before any engine build.

## Contents

| File | What it is |
|---|---|
| `content/` | **1A** — all original world content as JSON (99 areas, 8,487 rooms, 3,772 mobs, 2,798 objects, 5,359 spawns, 16 classes, 24 races, 559 skills) + `content/summary.md` with counts and validation. |
| `systems-spec.md` | **1B** — how the game *behaves* (combat, progression, skills/spells, world/movement, economy/loot/identify, staff powers), so the new engine reproduces the feel. House-rule customizations flagged. |
| `audit.md` | **1C** — license/IP audit: what's yours vs. Diku/Merc/SMAUG engine/stock, with an exclude list. |
| `architecture-plan.md` | **1D** — the concrete build: Node/TS authoritative server + in-memory world, Supabase schema, WebSocket protocol, permission system, Expo client, and a v1 vertical slice. |
| `tools/` | The extraction scripts (`parse_areas.py`, `parse_defs.py`) + how to re-run them. |

## Headlines

- **Extraction is verified 100%** against raw counts per file (mobs 3772/3772, objects
  2798/2798, rooms 8487/8487, 0 errors).
- **The world is your original work** — dominant builder **Drazuk**, owner/implementor **Pain**.
  Only a few clearly-stock files need dropping (`generic.are`, `limbo.are`, stock help entries,
  and an 8.7 MB crash `core` dump). See `audit.md`.
- **Signature custom systems to preserve:** fighting stances, tier/remort endgame, the luck
  stat, finite per-area economy pools, the automated quest/glory loop, cross-area level gates,
  and the 2-second combat round. See `systems-spec.md` §6.
- **Proposed v1 slice:** University of Alden (newbie school, start room 10300) + Drazukville
  (hub city, recall temple 21001) — ~350 curated rooms, full combat/progression/inventory,
  2+ players in a shared room. See `architecture-plan.md` §7.

Nothing here builds the engine yet — awaiting your review.
