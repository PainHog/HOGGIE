# House of Ghouls — Content Extraction Summary (Step 1A)

**Source:** `HouseOfGhouls/` (SMAUG 1.4-derived MUD, ~10 years of original content)
**Extraction date:** 2026-09-18
**Scope:** Read-only. Only *data* was read from the legacy tree; no engine C source was copied into the export.

## What was extracted

| Pile | Count | File |
|---|---:|---|
| Areas / zones | **99** | `areas.json` |
| Rooms | **8,487** | `rooms.json` |
| Mobs / NPCs | **3,772** | `mobs.json` |
| Objects / items | **2,798** | `objects.json` |
| Resets (spawns/placements) | **5,359** | `resets.json` |
| Classes | **16** | `classes.json` |
| Races | **24** | `races.json` |
| Skills / spells / tongues / weapon-profs | **559** | `skills.json` |
| Progression (per-class titles, HP/mana/exp curves) | 16 classes | `progression.json` |

All JSON is UTF-8, keyed by vnum where applicable, with legacy bitfields decoded into
human-readable flag lists (e.g. `act_flags`, `affect_flags`, `extra_flags`, `wear_flags`,
`sector`, `item_type`) using the game's own label tables.

## Validation

The parser reimplements the SMAUG area-file reader semantics (verified against the engine's
`load_mobiles` / `load_objects` / `load_rooms` / `load_resets` and the low-level
`fread_string` / `fread_number` / `fread_line` / `fread_bitvector` routines). Every parsed
entity was **cross-checked against a raw `#vnum` marker count per section, per file**:

- Mobs parsed **3,772 / 3,772** (100%)
- Objects parsed **2,798 / 2,798** (100%)
- Rooms parsed **8,487 / 8,487** (100%)
- **0 parse errors** across all 99 area files.

Notable format details handled correctly (these are where naive parsers break):
- **Extended bitvectors** written as `A&B` (e.g. `4194320&256`) that span multiple 32-bit words.
- **`#VERSION 1` magic-item spell names** stored as quoted words after weight/cost
  (`'word of recall' 'NONE' 'NONE'` on potions/scrolls/pills, one word on wands/staves,
  two on salves).
- **Mud/obj/room programs** (`> trigger arg~ body~ … |`) skipped structurally so `|` inside a
  program body does not desync the reader (774 mobs, 3 objects, 64 rooms carry scripts).

## Authorship (from each area's `#AUTHOR` tag)

The world is overwhelmingly the work of the game's own staff. Dominant builder is **Drazuk**
(the hub city is "Drazukville"); the implementor/owner handle in the immortal list is **Pain**.

| Author | Areas |
|---|---:|
| Drazuk | 48 |
| Nameless | 30 |
| Sirus | 3 |
| Drazuk/Nameless/Vash | 2 |
| Medea | 2 |
| Hades, Thor, Belerik, Zarous, Meryk, Ashlyn+Darwin, Dezmond, Abatha, Darwin, Rainsng/Draz | 1 each |
| **Stock+Drazuk** (limbo.are) | 1 |
| **"Your Name Here!"** (generic.are — stock SMAUG template) | 1 |
| (untagged) | 2 |

`generic.are` and `limbo.are` are flagged for the license audit (see `../audit.md`).

## Item type distribution (top)

`armor` 722 · `weapon` 324 · `potion` 196 · `trash` 173 · `food` 163 · `drinkcon` 155 ·
`treasure` 112 · `furniture` 101 · `container` 99 · `pill` 89 · `comp` 86 · `scroll` 80.

- **479** objects carry embedded spells (potions/scrolls/wands/staves/pills/salves).
- **520** objects carry stat affects (apply-to-wearer modifiers like `hitroll`, `strength`, `save_spell`).

## World / room distribution

Sectors (top): `inside` 2,403 · `city` 1,172 · `underground` 1,020 · `forest` 859 ·
`field` 851 · `water_noswim` 408 · `mountain` 319 · `water_swim` 311 · `desert` 293 · `air` 206.

## Mobs

Levels span **1–65** (mortal cap is 50; 51–65 are the immortal/god tiers). Roughly even spread
across tiers, with a large cluster at 60+ (endgame content):

`L1-9` 587 · `L10-19` 634 · `L20-29` 654 · `L30-39` 512 · `L40-49` 394 · `L50-59` 341 · `L60+` 650.

## Classes (16)

Base classes: **Mage, Cleric, Thief, Warrior, Thug, Druid, Ranger, Monk, Diabolist, Conjurer,
Jester, Shaman**. The final four — **Champion, Bishop, Rogue, Archmagi** — are **tier / remort
(prestige) classes**: they carry very low base HP-per-level (1–4) and very high exp cost
(130–150), consistent with being advanced classes converted into at end-game (the engine has
`tier` / `tierconvert` player flags). Each class defines learnable skills with per-skill
minimum level and adept cap, plus 66 gendered level-titles.

## Races (24)

`Human, Elf, Dwarf, Halfling, Pixie, Minotaur, Half-Ogre, Half-Orc, Half-Troll, Half-Elf,
Gith, Drow, Sea-Elf, Lizardman, Gnome, Ghoul, Goblin, Wolfen, Shuri, Gulran, Zephyr, Jinn,
Ahpock` — plus a `Deep-Gnome.race` file present but not in the load list.

Each race defines stat modifiers, resist/immune/suscept, language, alignment bounds,
size, regen rates, and a **class-restriction** mask (decoded into `allowed_classes` /
`restricted_classes`). Examples: Human/Ghoul/Half-Elf allow all classes; Pixies cannot be
Warriors/Thugs/Rangers/Monks; Dwarves cannot be Mages/Monks/Shamans; the four tier classes
are open to every race. **Ghoul** is the signature race (the game is *House of Ghouls*).

## Skills / spells (559)

`Spell` 356 · `Skill` 170 · `Tongue` 22 · `Weapon` 11. Each entry carries name, type, slot,
mana cost, minimum position, minimum level, target type, the engine handler name it bound to
(`code_fn`, recorded for behavior-mapping only — not carried as code), and combat/damage
messages where present.

## Not extracted here (by design)

- `economy/*.are` — 87 files, each a single number: per-area accumulated shop-economy gold.
  This is **live save state**, not designed content. Noted, not extracted.
- `player/` pfiles, boards, clans/councils/deity records, logs — runtime/account state, not
  world content. (Clans/councils/deity are candidates for a later pass if you want to carry
  the guild/religion structures forward.)
- Mud/obj/room **program scripts** are flagged per-entity (`has_mobprogs` etc.) but their
  bodies are not transcribed; their *behavior* is described in `../systems-spec.md`.

## File guide

```
content/
  areas.json        99 areas: name, author, version, level range, flags, reset msg, counts, vnum span
  rooms.json        8,487 rooms: name, description, sector, room_flags, exits (dir/dest/flags/key), extra descs
  mobs.json         3,772 mobs: descriptions, level, act/affect flags, alignment, thac0, ac, hp/dam dice,
                    gold, exp, position, sex, stats, saves, race/class ids, special attacks/defenses, script flag
  objects.json      2,798 items: type, extra/wear flags, 15 values, weight, cost, embedded spells, stat affects
  resets.json       5,359 spawn/placement records (spawn_mob, equip_mob, give_to_mob, place_object, put_in_container, door_state)
  classes.json      16 classes: attrs, thac0 curve, hp/mana/exp per level, skill list (level+adept), 66 titles each
  races.json        24 races: stat mods, resist/immune, language, align, size, regen, allowed/restricted classes
  skills.json       559 skills/spells/tongues/weapon-profs: slot, mana, level, target, position, handler, messages
  progression.json  per-class HP/mana/exp curves + max title level + skill count
```
