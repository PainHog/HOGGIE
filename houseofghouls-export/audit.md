# House of Ghouls — License / IP Audit (Step 1C)

**Purpose:** identify what is **yours** (original creative content, safe to carry forward),
what is **engine / stock** (Diku / Merc / SMAUG — must **not** be carried into the new,
fresh codebase), and what is **third-party** or **unclear**.

**Method:** scanned every file under `HouseOfGhouls/` for the DikuMud/Merc/SMAUG copyright
headers and license phrases (`DikuMud`, `Merc Diku`, `SMAUG 1.x`, `Sebastian Hammer`,
`Michael Chastain`, `Derek Snider`, `copyright 199x`), and cross-referenced against the
license files the distribution requires you to keep (`doc/license.diku`, `doc/license.merc`,
`doc/license.txt`).

## The chain of copyright (from the license files)

1. **DikuMud** © 1990–1991 Sebastian Hammer, Michael Seifert, Hans Henrik Størfeldt, Tom
   Madsen, Katja Nyboe. *Not public domain.* No commercial use. (`doc/license.diku`)
2. **Merc 2.1** © 1992–1993 Michael Chastain, Michael Quan, Mitchell Tse — derivative of Diku.
   (`doc/license.merc`)
3. **SMAUG 1.4** © 1994–1998 Derek Snider & the SMAUG team — derivative of Merc.
   (`doc/license.txt`)

Every `.c`/`.h` file in `src/` carries this three-tier header. **The engine and everything
shipped with it are not yours.** Your original creative content sits *on top of* it as data.

## Bottom line

- **The new engine must be written fresh** (this is already the plan). Do **not** copy any
  `src/*.c`, `src/*.h`, or the SMAUG docs into the new repo — not even as a starting point.
- **Your world data is portable.** The area/class/race/skill data files are your original
  creative work and carry **no** Diku/Merc/SMAUG copyright notices. The Step 1A JSON export
  is the clean carry-forward artifact — it contains data values only, no engine code.
- A short list of **stock content** files must be dropped or rebuilt (below).

---

## Classification by pile

### MINE — original content, safe to carry forward (as data)

| Pile | Path | Notes |
|---|---|---|
| World areas | `area/*.are` (**97 of 99**) | Original zones by your staff (Drazuk, Nameless, Sirus, Medea, …). No embedded copyright. Exceptions: `generic.are`, `limbo.are` — see STOCK. |
| Classes | `classes/*.class` (16) | Original class definitions + per-level titles. No notices. (`Mercenary` title is a false-positive for "merc".) |
| Races | `races/*.race` (24) | Original race definitions incl. the signature **Ghoul**. No notices. |
| Skills/spells | `system/skills.dat` (559) | Your skill/spell list, tuning, and combat messages. **Caveat below** re: the *names/handlers* of classic spells. |
| Game data | `system/` data files | `socials.dat`, `commands.dat`, `herbs.dat`, `morph.dat`, `liquidtable.dat`, `mixturetable.dat`, `tongues.dat`, `quest.dat`, score tables, etc. — your configuration/content. No notices. |
| Clans / councils / deity | `clans/`, `councils/`, `deity/`, `gods/` | Your guild/religion/immortal structures (candidates for a later extraction pass). |
| Lua scripts | `lua/*.lua` (40) | Original scripts written for this MUD (`attacks.lua`, `dreams.lua`, `help_*.lua`, aliases). **Behavior is yours; the code is engine-coupled** (calls the engine's Lua bindings), so reproduce the behavior rather than porting verbatim. |
| Mud/obj/room programs | inline in `area/*.are` | Your NPC/room scripting (774 mobs, 64 rooms). Behavior is yours; syntax is SMAUG's. |

### STOCK-OR-ENGINE — do NOT carry into the new codebase

| Item | Path | Why |
|---|---|---|
| **Entire engine** | `src/*.c`, `src/*.h` (~85 files) | DikuMud/Merc/SMAUG derived. Every file carries the copyright header. Includes custom modules (`act_job.c`, `antitank.c`, `bottle.c`, `editor.c`, `locker.c`, `planes.c`, `ratings.c`, `train.c`) — original *code* but built on and licensed under the SMAUG stack, so still excluded from a fresh, unencumbered codebase. |
| Build artifacts | `src/*.o`, `src/smaug` binary, `src/liblua.a` | Compiled output; drop. |
| **Crash core dump** | `area/core` (**8.7 MB**) | ELF core file from the crashed `smaug` binary. Not content — **delete**; it also bloats the repo. |
| SMAUG documentation | `doc/SMAUGDOC`, `doc/smaug.txt`, `doc/smaugspells.txt`, `doc/license.*`, `doc/Mob.help`, `doc/Object.help`, `doc/Room.help`, `doc/Resets.help`, `doc/Prog.help`, `doc/area.txt`, `doc/olc.txt`, `doc/vnum.txt`, `doc/skill.txt`, `doc/class.txt`, `doc/hacker*.txt`, `doc/readme.txt`, `doc/contrib.txt`, … | SMAUG's own manuals/credits. Useful as *reference* while building (they document the file formats), but not to ship. |
| Stock example area | `doc/mudprogs/Example.are`, `doc/mudprogs/Beggar.prg`, `doc/mudprogs/DOC` | SMAUG mudprog examples/docs. |
| **Generic template area** | `area/generic.are` | `#AUTHOR Your Name Here!` — the empty SMAUG builder template. Stock. Drop. |
| **Limbo (partial)** | `area/limbo.are` | `#AUTHOR Stock+Drazuk`, uses the reserved stock vnums `#1/#2/#3`. Limbo is SMAUG's standard holding room. Rebuild fresh (it's tiny — 23 rooms). |

### THIRD-PARTY — separate licenses, not yours and not SMAUG's

| Item | Path | License |
|---|---|---|
| Lua interpreter | `src/lua.h`, `src/lauxlib.h`, `src/lualib.h`, `src/luaconf.h`, `src/liblua.a` | Lua — MIT. (In the new stack you'll use a modern JS/TS runtime; not needed.) |
| IMC2 inter-mud chat | `doc/imc2/*` (COPYING, README, Makefile, …) and IMC2 code in `src/` | IMC2's own license. Not needed unless you rebuild inter-mud chat. |

### UNCLEAR / MIXED — review before carrying

| Item | Path | Issue |
|---|---|---|
| **Help files** | `area/help.are`, `area/help2.are` | Contain the **license-required stock SMAUG help entries** (`help smaug`/`merc`/`diku`, the credits naming Sebastian Hammer & Derek Snider) **mixed with your own custom help text**. Extract only *your* help topics (game lore, commands, class/race guides) and drop the stock license entries. Do not ship the stock credits text. |
| **Classic spell names & handlers** | `system/skills.dat` `Code` fields | The *data* (mana, level, messages, tuning) is yours, but many of the 356 spells are the **standard Diku/SMAUG spell set** (`armor`, `cure light`, `magic missile`, `fireball`, etc.) and each row's `Code` field names a SMAUG engine handler (`spell_smaug`, `spell_acid_blast`, …). Spell *names* and generic RPG mechanics aren't protectable the way source code is, but when you reimplement, write the behavior fresh from the described effect — don't reference the SMAUG handler source. Your **original** spells and all balance choices are unambiguously yours. |
| Player / runtime state | `player/`, `boards/`, `watch/`, `system/*.log`, `economy/*.are` | Live account/runtime data, not designed content. Migrate real player accounts only if you intend continuity; otherwise leave behind. Not an IP issue, a data-migration choice. |

---

## Files that literally carry a Diku/Merc/SMAUG name or notice

For a definitive exclude list, these are every non-`src` file found carrying the copyright
strings (the `src/` tree is excluded wholesale and not re-listed):

- `area/help.are`, `area/help2.are` — stock license help text (mixed; see above)
- `area/core` — crash dump referencing the `smaug` binary (delete)
- `doc/license.txt`, `doc/license.merc`, `doc/license.diku` — the license files themselves
- `doc/smaug.txt`, `doc/readme.txt`, `doc/contrib.txt`, `doc/olc.txt`, `doc/vnum.txt` — SMAUG docs
- `doc/mudprogs/DOC` — SMAUG mudprog manual
- `doc/imc2/COPYING`, `doc/imc2/README` — IMC2 third-party license

Everything under `classes/`, `races/`, and the `system/` game-data files scanned **clean**
(only substring false-positives: "Mercenary", "mercy", "merciless").

## Recommendation

1. Start the new repository empty. Bring across **only the Step 1A JSON** (`content/*.json`)
   as your world seed.
2. Keep the SMAUG docs and this legacy tree **out of the new repo**, but retain read access to
   them locally as a behavior reference while building (they explain the file formats and the
   systems documented in `systems-spec.md`).
3. Rebuild `limbo.are` and the recall/temple hub fresh; drop `generic.are` and `area/core`.
4. When extracting help text, filter out the stock SMAUG/Merc/Diku credit entries from
   `help.are`/`help2.are`.
5. Reimplement spells/skills from the **described behavior**, not from the SMAUG handlers.
