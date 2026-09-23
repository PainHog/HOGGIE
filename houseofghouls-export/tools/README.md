# Extraction tools

These two scripts produced everything in `../content/`. They are **read-only** over the
legacy tree and copy no engine source — they reimplement the SMAUG area-file reader semantics
to pull out data values only.

## Usage

```bash
# from repo root, with the legacy tree at HouseOfGhouls/
python3 tools/parse_areas.py   # -> content/{areas,rooms,mobs,objects,resets}.json + _extract_stats.json
python3 tools/parse_defs.py    # -> content/{classes,races,skills,progression}.json
```

Both scripts hardcode `SRC=/home/user/HOGGIE/HouseOfGhouls` and
`OUT=/home/user/HOGGIE/houseofghouls-export/content`; edit those two constants to relocate.

## What they handle (the tricky bits)

- SMAUG `fread_string`/`fread_number`/`fread_line` semantics, including `fread_line` skipping
  leading whitespace.
- **Extended bitvectors** (`A&B` multi-word flags) and `|`-OR'd numbers.
- **`#VERSION 1`** magic items storing spell names as quoted words.
- Mud/obj/room **program blocks** (`> trigger arg~ body~ … |`) skipped structurally.
- Flag decoding via the game's own label tables (item types, wear/apply/room/sector flags,
  act/affect flags, attack/defense flags), and race/class id→name from the load-order lists.

## Verification

`parse_areas.py` output was cross-checked against a raw `#vnum` marker count per section per
file: mobs 3772/3772, objects 2798/2798, rooms 8487/8487, 0 errors.
