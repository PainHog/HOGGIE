/**
 * Fighter — a uniform combat view over a player Character or a live MobInstance, so the combat
 * math in combat.ts treats both the same. hp/position/roomVnum proxy to the underlying object
 * so presence, persistence, and combat all see one source of truth.
 *
 * Derived combat inputs follow systems-spec §1 (ascending to-hit, house AC handling, RIS).
 */
import { parseColorSpans, type ServerMessage } from "@hoggie/shared";
import type { Stats } from "../world/model.ts";
import type { World } from "../world/world.ts";
import { effectiveLevel, statMod, type Character } from "./character.ts";
import type { MobInstance } from "./mobInstance.ts";
import { parseDice, rollDice } from "./dice.ts";
import type { Rng } from "./rng.ts";
import { resistAdds, sumMods, type Affect } from "./affects.ts";
import { equipTotals } from "./items.ts";
import { vitalsOf } from "./view.ts";

const DEFAULT_STATS: Stats = { str: 13, int: 13, wis: 13, dex: 13, con: 13, cha: 13, lck: 13 };

export interface Fighter {
  readonly isPlayer: boolean;
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly alignment: number;
  hp: number;
  readonly maxHp: number;
  position: string;
  readonly roomVnum: number;

  readonly ac: number;
  readonly hitroll: number;
  readonly damroll: number;
  readonly thac0Mod: number;
  readonly profBonus: number;
  readonly stats: Stats;
  readonly numAttacks: number;
  readonly damageType: string;
  readonly resist: ReadonlySet<string>;
  readonly immune: ReadonlySet<string>;
  readonly suscept: ReadonlySet<string>;
  /** Total worn-armour AC (drives damage absorption); 0 for the unarmoured / mobs. */
  readonly wornArmor: number;
  /** Sanctuary: incoming damage is halved while active (mob affect flag or the spell buff). */
  readonly sanctuary: boolean;
  /** Damage-shield elements that sear anyone who strikes this fighter (fire/cold/shock). */
  readonly damageShields: readonly string[];
  /** Special-attack names this fighter can unleash mid-round (mobs only; players' are roadmap). */
  readonly specials: readonly string[];
  /** Special-defense names (dodge/parry/disarm/…) this fighter can use (mobs only; players' roadmap). */
  readonly defenses: readonly string[];
  /** Active spell affects (buffs/debuffs), for combat folding + status display. */
  readonly affects: Affect[];

  fighting: Fighter | null;

  rollBaseDamage(rng: Rng): number;
  /** Narrative to the controlling player (no-op for mobs). */
  send(line: string): void;
  /** Push fresh vitals/state to the controlling player after a combat round (no-op for mobs). */
  afterRound(): void;
  readonly alive: boolean;
}

/** Mob to-hit modifier scales by level band (faithful to the engine). */
function mobThac0Mod(level: number): number {
  if (level <= 10) return 1;
  if (level <= 20) return 2;
  if (level <= 30) return 4;
  if (level <= 40) return 5;
  return 7;
}

export class PlayerFighter implements Fighter {
  readonly isPlayer = true;
  fighting: Fighter | null = null;
  private readonly resistSet: ReadonlySet<string>;
  private readonly susceptSet: ReadonlySet<string>;

  constructor(
    readonly character: Character,
    private readonly world: World,
    private readonly sendMsg: (msg: ServerMessage) => void,
  ) {
    const race = world.races.get(character.raceId);
    this.resistSet = new Set(race?.resistant ?? []);
    this.susceptSet = new Set(race?.susceptible ?? []);
  }

  get id() { return this.character.id; }
  get name() { return this.character.name; }
  // Tiered characters fight at their effective level (50 + level/10), keeping their earned power.
  get level() { return effectiveLevel(this.character); }
  get alignment() { return this.character.alignment; }
  get hp() { return this.character.hp; }
  set hp(v: number) { this.character.hp = v; }
  get maxHp() { return this.character.maxHp; }
  get position() { return this.character.position; }
  set position(v: string) { this.character.position = v; }
  get roomVnum() { return this.character.roomVnum; }
  get stats() {
    const base = this.character.stats, a = sumMods(this.character.affects), e = this.equip.mods;
    return {
      str: base.str + a.str + e.str, int: base.int + a.int + e.int, wis: base.wis + a.wis + e.wis,
      dex: base.dex + a.dex + e.dex, con: base.con + a.con + e.con, cha: base.cha + a.cha + e.cha, lck: base.lck + a.lck + e.lck,
    };
  }
  get alive() { return this.character.hp > 0; }
  get affects() { return this.character.affects; }

  private get race() { return this.world.races.get(this.character.raceId); }
  private get mods() { return sumMods(this.character.affects); }
  private get equip() { return equipTotals(this.character.equipment ?? {}, (v) => this.world.getObjPrototype(v)); }

  // Naked baseline + racial AC modifier + affect AC + worn-armor AC.
  get ac() { return 100 + (this.race?.acPlus ?? 0) + this.mods.ac + this.equip.acBonus; }
  get wornArmor() { return Math.max(0, this.equip.acBonus + this.mods.ac); }
  get sanctuary() { return this.character.affects.some((a) => a.name === "sanctuary"); }
  get damageShields(): readonly string[] { return EMPTY_ARR; } // player damage-shields are roadmap
  get specials(): readonly string[] { return EMPTY_ARR; } // player specials are skill-gated (roadmap)
  get defenses(): readonly string[] { return EMPTY_ARR; } // player active defenses are skill-gated (roadmap)
  get hitroll() { return statMod(this.stats.str) + Math.floor(this.character.level / 10) + (this.race?.hitPlus ?? 0) + this.mods.hitroll + this.equip.mods.hitroll; }
  get damroll() { return statMod(this.stats.str) + Math.floor(this.character.level / 8) + this.mods.damroll + this.equip.mods.damroll; }
  get thac0Mod() {
    const primary = this.world.classes.get(this.character.classId)?.thac0Mod ?? 0;
    const dualId = this.character.dualClassId;
    if (dualId == null || dualId === this.character.classId) return primary;
    // Dual-class combat blend: the better base plus 0.7x the weaker (systems-spec §2).
    const dual = this.world.classes.get(dualId)?.thac0Mod ?? 0;
    return Math.floor(Math.max(primary, dual) + 0.7 * Math.min(primary, dual));
  }
  get profBonus() { return this.equip.weapon ? 0 : -2; } // wielding removes the unarmed penalty
  get numAttacks() { return 1; } // extra attacks are skill-gated (roadmap)
  get damageType() { return this.equip.weapon?.damageType ?? "blunt"; }
  get resist(): ReadonlySet<string> {
    const extra = resistAdds(this.character.affects);
    return extra.length ? new Set([...this.resistSet, ...extra]) : this.resistSet;
  }
  get immune(): ReadonlySet<string> { return EMPTY; }
  get suscept(): ReadonlySet<string> { return this.susceptSet; }

  rollBaseDamage(rng: Rng): number {
    const w = this.equip.weapon;
    if (w) return rng.dice(w.numDice, w.sizeDice); // wielded weapon dice
    return rng.dice(1, 4 + Math.floor(this.character.level / 3)); // barehand grows slowly
  }

  send(line: string): void {
    this.sendMsg({ t: "output", lines: [parseColorSpans(line)] });
  }

  afterRound(): void {
    this.sendMsg({ t: "vitals", vitals: vitalsOf(this.world, this.character) });
  }
}

export class MobFighter implements Fighter {
  readonly isPlayer = false;
  fighting: Fighter | null = null;
  private readonly resistSet: ReadonlySet<string>;
  private readonly immuneSet: ReadonlySet<string>;
  private readonly susceptSet: ReadonlySet<string>;

  constructor(readonly mob: MobInstance) {
    this.resistSet = new Set(mob.proto.resistant);
    this.immuneSet = new Set(mob.proto.immune);
    this.susceptSet = new Set(mob.proto.susceptible);
  }

  get id() { return this.mob.id; }
  get name() { return this.mob.proto.shortDesc || this.mob.proto.keywords || "someone"; }
  get level() { return this.mob.proto.level; }
  get alignment() { return this.mob.proto.alignment; }
  get hp() { return this.mob.hp; }
  set hp(v: number) { this.mob.hp = v; }
  get maxHp() { return this.mob.maxHp; }
  get position() { return this.mob.position; }
  set position(v: string) { this.mob.position = v; }
  get roomVnum() { return this.mob.roomVnum; }
  get stats() {
    const base = this.mob.proto.stats ?? DEFAULT_STATS, m = sumMods(this.mob.affects);
    return {
      str: base.str + m.str, int: base.int + m.int, wis: base.wis + m.wis, dex: base.dex + m.dex,
      con: base.con + m.con, cha: base.cha + m.cha, lck: base.lck + m.lck,
    };
  }
  get alive() { return this.mob.hp > 0; }
  get affects() { return this.mob.affects; }
  private get mods() { return sumMods(this.mob.affects); }

  get ac() { return this.mob.proto.ac + this.mods.ac; }
  get wornArmor() { return 0; } // mobs use their proto AC directly (no worn-gear absorb)
  get sanctuary() { return this.mob.proto.affectFlags.includes("sanctuary"); }
  get damageShields(): readonly string[] { return this.mob.proto.affectFlags.filter((f) => SHIELD_FLAGS.has(f)); }
  get specials(): readonly string[] { return this.mob.proto.specialAttacks; }
  get defenses(): readonly string[] { return this.mob.proto.specialDefenses; }
  get hitroll() { return (this.mob.proto.hitroll ?? 0) + this.mods.hitroll; }
  get damroll() { return (this.mob.proto.damroll ?? 0) + this.mods.damroll; }
  get thac0Mod() { return mobThac0Mod(this.mob.proto.level); }
  get profBonus() { return 2; }
  get numAttacks() { return this.mob.proto.numAttacks && this.mob.proto.numAttacks > 0 ? this.mob.proto.numAttacks : 1; }
  get damageType() { return "blunt"; }
  get resist(): ReadonlySet<string> {
    const extra = resistAdds(this.mob.affects);
    return extra.length ? new Set([...this.resistSet, ...extra]) : this.resistSet;
  }
  get immune(): ReadonlySet<string> { return this.immuneSet; }
  get suscept(): ReadonlySet<string> { return this.susceptSet; }

  rollBaseDamage(rng: Rng): number {
    const d = parseDice(this.mob.proto.damDice);
    if (d.n > 0 && d.s > 0) return rollDice(d, rng);
    return rng.dice(1, 4) + Math.floor(this.mob.proto.level / 2);
  }

  send(): void {
    /* mobs have no client */
  }

  afterRound(): void {
    /* mobs have no client */
  }
}

const EMPTY: ReadonlySet<string> = new Set();
const EMPTY_ARR: readonly string[] = [];
/** Mob affect flags that retaliate against attackers. */
export const SHIELD_FLAGS = new Set(["fireshield", "iceshield", "shockshield"]);
/** Damage element each shield flag deals back. */
export const SHIELD_ELEMENT: Record<string, string> = { fireshield: "fire", iceshield: "cold", shockshield: "lightning" };
