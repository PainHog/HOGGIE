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
import { statMod, type Character } from "./character.ts";
import type { MobInstance } from "./mobInstance.ts";
import { parseDice, rollDice } from "./dice.ts";
import type { Rng } from "./rng.ts";
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
  get level() { return this.character.level; }
  get alignment() { return this.character.alignment; }
  get hp() { return this.character.hp; }
  set hp(v: number) { this.character.hp = v; }
  get maxHp() { return this.character.maxHp; }
  get position() { return this.character.position; }
  set position(v: string) { this.character.position = v; }
  get roomVnum() { return this.character.roomVnum; }
  get stats() { return this.character.stats; }
  get alive() { return this.character.hp > 0; }

  private get race() { return this.world.races.get(this.character.raceId); }

  // Naked baseline + racial AC modifier; worn armor is roadmap.
  get ac() { return 100 + (this.race?.acPlus ?? 0); }
  get hitroll() { return statMod(this.character.stats.str) + Math.floor(this.character.level / 10) + (this.race?.hitPlus ?? 0); }
  get damroll() { return statMod(this.character.stats.str) + Math.floor(this.character.level / 8); }
  get thac0Mod() { return this.world.classes.get(this.character.classId)?.thac0Mod ?? 0; }
  get profBonus() { return -2; } // unarmed / no weapon proficiency yet
  get numAttacks() { return 1; } // extra attacks are skill-gated (roadmap)
  get damageType() { return "blunt"; }
  get resist(): ReadonlySet<string> { return this.resistSet; }
  get immune(): ReadonlySet<string> { return EMPTY; }
  get suscept(): ReadonlySet<string> { return this.susceptSet; }

  rollBaseDamage(rng: Rng): number {
    // barehand dice grow slowly with level
    return rng.dice(1, 4 + Math.floor(this.character.level / 3));
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
  get stats() { return this.mob.proto.stats ?? DEFAULT_STATS; }
  get alive() { return this.mob.hp > 0; }

  get ac() { return this.mob.proto.ac; }
  get hitroll() { return this.mob.proto.hitroll ?? 0; }
  get damroll() { return this.mob.proto.damroll ?? 0; }
  get thac0Mod() { return mobThac0Mod(this.mob.proto.level); }
  get profBonus() { return 2; }
  get numAttacks() { return this.mob.proto.numAttacks && this.mob.proto.numAttacks > 0 ? this.mob.proto.numAttacks : 1; }
  get damageType() { return "blunt"; }
  get resist(): ReadonlySet<string> { return this.resistSet; }
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
