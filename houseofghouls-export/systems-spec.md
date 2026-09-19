# House of Ghouls — Systems Behavior Spec (Step 1B)

How the game **behaves**, so the fresh engine can reproduce the feel without touching or
copying the old source. Formulas were read from the running game's logic and its data and are
restated as behavior. **[custom]** marks a clear house rule that diverges from stock
Diku/SMAUG; those are the things that make *this* game feel like itself and are the highest
priority to preserve.

## Foundational constants

- **Levels:** mortals **1–50**, immortals/staff **51–65** (`MAX_LEVEL=65`; mortal cap
  "Avatar/Hero" = 50). Advancement hard-stops at 50.
- **7 attributes:** STR, INT, WIS, DEX, CON, **LCK (luck)** [custom 7th stat], CHA.
- **Currency:** gold only (no silver). Plus non-gold point pools: **quest points ("glory")**,
  **pkill count**, **practice points**.
- **Tick model** [custom timing — faster than stock]: engine runs **10 pulses/sec**.
  Combat round = **2s** (`PULSE_VIOLENCE`), mob AI = 3s, fast regen = **7s**, world tick /
  area repop = **60s**. 1 game hour = 60 real seconds (a full game day ≈ 24 real minutes).

---

## 1. Combat resolution

Real-time, **2-second rounds**: while combatants are fighting, each round every combatant
takes their attacks; everyone in the room sees the blows. Classic MUD rhythm — **preserve it**.

### 1.1 Fighting stances **[custom — signature feature]**
A combatant's **position doubles as a combat stance** trading offense for defense. The
multiplier applies to damage **dealt** (your stance) *and* damage **taken** (target's stance):

| Stance | Damage multiplier |
|---|---|
| Berserk | ×1.3 |
| Aggressive | ×1.2 |
| Standing (normal) | ×1.0 |
| Defensive | ×0.75 |
| Evasive | ×0.6 |

### 1.2 To-hit (ascending score — **[custom]**, not descending THAC0)
```
hit_score  = 45 + (attacker_level + class_thac0mod + weapon_prof_bonus) + (hitroll / 5)
target_def = -1 * clamp(|target_AC/10|, 0..50)          # better armor => more negative
roll       = random(1..100)
HIT if roll >= 95  (always)  OR  roll > (hit_score + target_def)
```
- 95+ always hits. A middle band is **"deflected by armor"** (near-miss, scaled by target DEX)
  vs. a clean miss. NPCs are ~+20 easier to hit than equal-AC PCs [custom]. `enhanced hit`
  adds `level/5`. Blind/unseen modifiers apply.

### 1.3 Damage
```
base = weapon dice[value1..value2]  (armed)  |  barehand dice + damplus  (unarmed/NPC)
dam  = base + damroll + prof_bonus/10
dam *= attacker_stance * target_stance                  # §1.1
dam *= 2 if target asleep/unaware
dam *= special-attack band multiplier                   # §1.4
dam += target.saving_damage/2 ; += worn-armor absorb (PC L>5: armorworn/10)
dam  = max(dam,1) ; then RIS filter                      # §1.5
```

### 1.4 Special attacks — level-band multipliers **[custom scaling]**
Single-strike openers/finishers scaling over bands (≤9/10-19/20-29/30-39/40+):
**backstab** ×2.5→×7 · **circle** ×1.5→×5 · **crush** ×1.5→×5 · **ambush** ×1.5→×4.25 ·
**snipe** (ranged) ×2→×5.

### 1.5 Resist / Immune / Suscept (RIS)
Mobs/items are resistant / immune / susceptible to damage classes (fire, cold, electricity,
energy, blunt, pierce, slash, acid, poison, drain, sleep, charm, hold, magic/nonmagic,
paralysis). Resist reduces, immune negates, suscept amplifies. Weapons carry **PLUS1–PLUS6**
tiers to punch through matching resists; magic vs. nonmagic damage is tracked separately.

### 1.6 Multiple attacks
Resolve sequentially per round, each gated by skill %: **second** ≈ `learned/1.5`,
**third** ≈ `(learned + dual_bonus·1.5)/2`, **fourth/fifth** (warrior L30/L40), **dual wield**
(alternating weapons), **berserk** bonus strike. Low move (<10) penalizes; **immortals always
get all attacks**; NPCs use a fixed `numattacks`.

### 1.7 PvP
PvP looting is **ON** (`Pkloot`). PvP damage and skill-effect chances are tuned separately
(`Stunplrvsplr`, `Gougepvp`, `Bashpvp`, per-side damage %). Killer/attacker flagging tracks
illegal PKs; some rooms/areas are safe/no-PK; recent-fight timers gate disengage.

---

## 2. Progression

### 2.1 Exp to next level (TNL)
```
exp_to_reach(level) = level³ × 0.95 × class_exp_base          # [custom] 0.95 scale ("reduce tnl")
```
`class_exp_base` = the `Expbase` in each class (base classes 45–60; **tier classes 130–150**).
Dual-class blends: higher base + 0.7 × lower base.

### 2.2 Exp per kill
Per group member, NPC kills only (no exp for killing PCs):
```
xp  = ((victim_level - your_level) + 10) * 10  +  victim_level*2
xp += 25 if alignments differ else -25
xp *= race_exp_multiplier/100                     # e.g. Ghoul 80%
xp += buff bonuses on victim (sanctuary +50, shields +35 ea, mighty +250, …)
xp += random(-15,30) ;  xp = 1 if victim is 10+ levels under you ;  xp = max(xp,1)
```
Low, additive numbers — leveling is a many-kill grind, rewarded for fighting up-level and
cross-alignment.

### 2.3 On level-up (`advance_level`)
- **HP** += `con_hp_bonus + random(class Hpmin, Hpmax)` (Warrior 10–20+CON; casters 6–15).
- **Mana** += `random(int/2, (int+wis)/2)` for casting classes, else 0.
- **Move** += `random(10, con+dex)`.
- **Practices** += `wis_practice + 1` (+2 if dual-class); **[custom]** luck roll can grant +3
  bonus practices; PKers get +2 HP.
- Full HP/mana/move restore; food/thirst topped up.

### 2.4 Tier / remort (prestige) **[custom — signature endgame]**
`advancetier` at **exactly level 50**, single-class (not dual), tier ≤ 1, and **≥ 500,000 gold**:
spends the 500k, sets the tier flag, **swaps to the tier class**, **resets level to 2**, banks
old exp into `tierexp`, grants **+20 practices**. You then re-level 2→50 on the tier track with
tiny per-level gains (HP/mana/move each `random(1,4)`) but keep earned power. Mapping:
- **Champion** ← Warrior / Ranger / Monk
- **Bishop** ← Diabolist / Cleric / Shaman
- **Rogue** ← Thief / Thug / Jester
- **Archmagi** ← Mage / Druid / Conjurer

Tiered characters act/cast at **effective level `50 + level/10`**. Dual-class (a second class
blended for thac0/attacks) is a separate build option.

### 2.5 Skills (learn-by-use — mostly stock SMAUG)
- **559** learnables: **356 spells, 170 skills, 22 tongues (languages), 11 weapon profs.**
- Each is 0–100%, usable once `level ≥ grant_level` (from the class file), practiced up from 0.
- **On use:** success rolls to raise the % (+1/+2) toward the skill's adept cap; failure can
  give +1. `int_learn%` per practice session at a trainer; **adept cap** = per-class
  `Skilladept` (Warrior 85, tier 95) intersected with each skill's own cap.
- Weapon-proficiency families: axes, bludgeons, long/short blades, polearms, pugilism,
  talonous/flexible/exotic arms, missile weapons, shieldwork.

### 2.6 Stats (what each does)
STR → hitroll, damroll, carry capacity, max weapon weight · INT → % learned per practice ·
WIS → practices granted per level · DEX → AC/defense + gates extra attacks/skills ·
CON → HP per level + system-shock survival · CHA → shop haggling + charm · **LCK → luck rolls
(bonus practices, saves)** [custom].

### 2.7 Spellcasting
Cost the spell's mana (must have it first). **Failure** if
`random(1..100) + spell_difficulty*5 > learned%` → half mana lost + a failure-learn tick; on
success full mana spent, spell fires at caster level (tier/empowered raise effective level).
**Saving throws** (5 categories: damage, wands, para/petri, breath, spell/staff):
`save% = clamp(20 + (victim_level - spell_level - victim_save_bonus), 5..95)`; a made save
halves or negates. RIS_MAGIC immunity auto-saves.

---

## 3. Movement & the shared world

### 3.1 Moving between rooms
Each step spends `move` by **sector cost**: inside 1, city/field 2, forest 3, hills/water-swim 4,
underground 4, mountain/underwater/desert 6, oceanfloor 7, **air 10**; water-noswim 1.
Encumbrance scales it; **flying/floating costs 1**. Out of `move` → "too exhausted." Mounts
spend the mount's move.

**Blocks:** closed/locked doors (unless immortal or pass-door & not no-pass); windows that
aren't doors; **air/fly exits require flying**; **deep water requires floating or an
ITEM_BOAT** (mounts drown); climb exits roll `climb` (fail = fall + damage); private/DND rooms;
tunnel capacity limits; charmed pets won't leave their master. **[custom] cross-area level
gates:** you can't enter an area whose hard level range is above/below you ("not ready to go
down that path"). Drunk/nuisance causes random-direction stumbling.

### 3.2 Exits & doors
**11 directions** (N,E,S,W,U,D,NE,NW,SE,SW,"somewhere"). Door flags: isdoor, closed, locked,
secret, pickproof, fly, climb, dig, nopassdoor, hidden, passage, portal, bashed, bashproof,
nomob, window. Keys checked from inventory; **pick lock** (skill, blocked by pickproof);
**bash door** (opens both sides, blocked by bashproof); **pass door** (affect, unless
nopassdoor). Door state mirrors to the reverse exit automatically.

### 3.3 Recall & travel
- **Recall room = 21001** — the **Drazukville temple** [custom; stock SMAUG is 3001]. Clan
  members recall to their clan hall instead.
- Blocked by no-recall rooms and curse. **[custom] "bad recall":** a tiny chance dumps you into
  one of ~30 hard-coded dangerous rooms. **Recall from combat** (L20–49) costs exp and can
  fail on a luck roll; L50+/sub-20 recall freely.
- **Immortal travel:** `goto` (self-teleport), `transfer` (pull others; "all" at high level).
  Spells: word of recall, teleport (random), gate, portal, astral walk, summon. Portal exits
  (NPCs can't follow) and timed teleport rooms exist.
- Race `Race_Recall` fields are all 0 / unused; ignore for the rebuild.

### 3.4 Time, weather, regen
World tick = 60s; area repop = 60s. **[custom] fast regen:** HP/mana/move regenerate every 7s
*and* every 60s. Base gain ≈ `level/5`; big bonuses when **resting** (+5+stat/2) or **sleeping**
(+5+stat) — HP scales CON, mana INT, move DEX. Healing rooms ×3, sitting on furniture ×2,
poison ÷4. Game clock: 1 hour = 60s real, 24-hour days with dawn/dusk echoes, per-**area**
weather (skipped indoors/underwater). (Note: the per-race regen fields in the data are saved
but unused by the engine — regen is position/stat driven.)

### 3.5 Death
Killed → a **corpse** is made holding the victim's gold + inventory + worn equipment; the
victim respawns at their **clan hall, else the altar (21001)**, resting, stats reset to race
defaults, hp/mana/move floored to 1. **[custom] exp loss:** a PC killed by a mob at L5–49 loses
`level*75` exp (down to the current level floor); L50+ and sub-5 lose nothing. Corpse decay:
NPC ≈ 6 ticks, pets ×3, **PC ≈ 60 ticks (~1 hr)**, 0 in the arena; PK/clan corpses save briefly
so they can be retrieved. Blood objects spawn in most sectors.

---

## 4. Economy, loot & items

### 4.1 Area economy **[custom — Darwin's rewrite, the biggest economic deviation]**
Money is **not** held by shopkeepers. Each **area owns a shared gold pool** (seeded ~250M,
auto-refilling toward 1M when drained), persisted per-area. **Buying, healing, and bank
deposits pour gold into the area pool; selling pulls gold out of it** — and you **cannot sell
an item worth more than the area's current pool**. This makes each region's wealth a finite,
shared, drainable resource (with global "looted" tracking). A faithful rebuild should model
per-region economy pools, not infinite shopkeeper wallets.

### 4.2 Shops
Price uses **charisma as the haggle lever**: `profitmod = 13 - buyer_CHA`.
```
BUY  = item.cost * max(profit_sell+1, profit_buy+profitmod)/100
SELL = item.cost * min(profit_sell+1, profit_buy+profitmod)/100   (only if the shop trades that item_type)
```
Wand/staff prices scale by remaining charges. Shops **don't restock gold**; items flagged
`inventory` are infinite supply (a fresh copy is minted on purchase, resale-worthless). You
can't sell owned/quest/timered/duplicate items. Buy up to 20 at once (bundled in a bag).
**Pet shops:** `pet_cost = (60 - CHA*2) * (pet_level*4)²`; pet corpses can be resurrected.
**Repair shops:** cost scales with an item's condition deficit.

### 4.3 Banks & healers
- **Bank** (`ACT_BANKER`): deposit/withdraw/balance; **5% deposit fee** (fee → area pool),
  withdraw free.
- **Healer** (`ACT_HEALER`, "heal <type>"): fixed gold prices — cure light 100, serious 500,
  critical 1000, heal 1500, cure blind/poison/curse 500, refresh 100, restore mana 1500,
  bless object 50000; gold → area pool.

### 4.4 Loot & corpses
A slain mob's corpse holds its gold + inventory + **worn equipment**. Player flags automate
pickup: **autogold** (+`split` shares gold, 5% tax on pickup), **autoloot** ("get all corpse"),
**autosac** (sacrifice for a small reward). `legal_loot` gates who may loot; corpses decay by
timer. PK corpses become clan corpses with a short retrieval window; quest items divert to an
owner-locked quest bag; lockers persist.

### 4.5 Identification & item quality
No `lore`/examine reveal — **only the `identify` spell** exposes stats: type, wear slot,
keywords, special (extra) flags, weight, cost, embedded spells + level (scrolls/potions/pills),
charges (wands/staves), applications (salves), **weapon damage low–high + average + class +
poison**, **armor AC**, and all worn stat-affects. Random "magic" items reveal their true name
on identify. **[custom] condition/quality:** weapons and armor carry a **condition value** that
**degrades with use** and is **repairable** (repair cost scales with wear); armor past its max
is "broken."

### 4.6 Wearing & item mechanics
**18 apply modifiers** activate when an item is worn (hitroll, stats, saves, AC, resist, etc.).
Wear slots: light, head, eyes, ears, face, neck×2, body, arms, wrist×2, hands, finger×2, about,
back, waist, legs, ankle×2, feet, **wield, dual-wield, shield, hold, pride×2, aura**. Dual-wield
and two-handed use require the relevant skills and are blocked by shield/hold. Food/drink move
`full`/`thirst`/`drunk` conditions (0–150). Light sources burn down `WEAR_LIGHT` hours.
Item flags include magic, enchanted, glow, hum, quest, random, ided, noremove, no-burn.

### 4.7 Quests **[custom — automated questmaster]**
Three flavors (adventure/mob/solo). A questmaster hands a random **recover-item (40%)** or
**kill-mob (60%)** quest with a 15–45 min timer and a 5/10 min cooldown. Rewards: **gold
1000–5000, glory 35–110, exp 250–500, 25% chance of 1–3 practices**. Spend **glory** on:
practices (≈15 glory each), reward items (dedicated vnum range), and item enhancements
(add glow/hum/no-burn/keyword for fixed glory costs).

---

## 5. Staff / immortal capabilities → modern permission system

The old system is **level-gated with a capability overlay**. This is what the new
**player / builder / moderator / admin** roles must reproduce.

### 5.1 Level ladder (51–65)
Master 51, **Immortal 52** (the "is immortal" line), Creator 53, Savior 54, Demi 55, TrueImm 56,
Lesser 57 (default OLC-modify level), **God 58** (full OLC), Greater 59, Ascendant 60 ("godly"
line), Sub-Implementor 61, **Implementor 62**, Eternal 63, Infinite 64, **Supreme 65 (owner)**.
Real staff cluster 52–65 (owner **Pain** = 65; **Tripper** = 58 God; plus Immortal/Savior/
Emissary ranks in the WIZLIST).

### 5.2 Permission model (three layers — rebuild as explicit capabilities)
1. **Per-command minimum level** — every command has a required level; it runs if
   `get_trust(char) ≥ command.level`. (These thresholds are config in `sysdata`, e.g.
   Build 61, Ban 61, Force 61, Msetplayer 62.)
2. **Trust override** — a character can be granted a `trust` level different from their level.
3. **Bestowments / council powers** — individual commands can be granted to a specific
   character (up to `bestow_dif` levels over trust) or to a clan/council's members.

The immortal roster persists as one file per immortal in `gods/` storing just **Level +
Pcflags**; the WIZLIST is rebuilt from these at boot. **Recommendation:** promote the implicit
trio (per-command level, trust override, bestowments) into a proper **named
role→capability model** rather than a single integer comparison.

### 5.3 Capability groups (what staff can do)
- **Building / OLC:** live room/mob/object/shop editors, dig/create, invoke/load, find/search.
- **World control:** goto, transfer/invade, load/reset/purge, restore, slay, force, echo,
  set weather, reset economy.
- **Player moderation:** deny, freeze, silence/no-emote/no-tell, disconnect, jail (hell),
  restrict, wizlock, snoop, watch, ban, pardon, switch/return.
- **Info / debug:** stat (room/mob/obj/player), users, command table, logs, where-is.
- **Admin / roster:** advance (promote/demote → writes godfile + reassigns areas), trust,
  bestow, immortalize, retire, rename, set password, reboot/shutdown/hotboot.

### 5.4 Builder sandboxing (already scoped — map straight to a "builder" role)
Each builder is **assigned an area** and constrained to that area's **per-type vnum ranges**
(separate room/object/mob ranges + soft/hard bounds + author). Edit gates: high staff (≥57/≥58)
edit anything; a builder may only modify a **prototype** object/room/mob whose vnum falls in
**their allocated range**. Assignment and range commands set this up. This is exactly a scoped
builder role — carry the area/vnum-range boundary forward.

### 5.5 Accounts & auth (rebuild target)
Today: **one character per login, no account layer**; passwords hashed with Unix `crypt()`
(DES) and stored in the pfile; a connection state machine drives creation/login; named
immortals can be pinned to approved hostnames. The new stack replaces this wholesale with
**Supabase Auth + real accounts** (many characters per account), which also cleanly enables the
role system above (see `architecture-plan.md`).

---

## 6. What to prioritize for the "feel"

The **[custom]** items are the identity of House of Ghouls and should be in the v1 engine or
its immediate roadmap:
1. **Fighting stances** (berserk/aggressive/standing/defensive/evasive as an offense/defense dial).
2. **Ascending to-hit + RIS + PLUS-tier weapons** damage model.
3. **Tier/remort** endgame (level 50 → prestige class, keep power, re-level).
4. **Luck (LCK)** as a real 7th stat.
5. **Area economy pools** (finite, shared, drainable regional wealth; CHA-based haggling).
6. **Automated quest/glory loop** (repeatable quests → glory → practices/rewards).
7. **Cross-area level gates** and the **Drazukville-temple (21001) recall hub**.
8. **Fast, position-based regen** and the classic **2-second combat round**.
