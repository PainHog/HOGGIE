/**
 * Runtime character: the live, in-memory representation of a player's avatar. Mirrors the
 * `characters` DB row plus live location. Persistence mapping lives in db/repos.ts.
 */
import type { RaceDef, Stats } from "../world/model.ts";
import type { World } from "../world/world.ts";
import type { Affect } from "./affects.ts";
import type { QuestTarget } from "./quest.ts";

/** A carried item — references an object prototype; containers hold nested items + open/lock state. */
export interface ItemInstance {
  vnum: number;
  /** For a container: the items inside it. */
  contents?: ItemInstance[];
  /** Container state (closeable/lockable containers). */
  closed?: boolean;
  locked?: boolean;
}

export interface Character {
  id: string;
  accountId: string;
  name: string;
  raceId: number;
  classId: number;
  /** Optional second class chosen at creation (dual-class). Undefined = single-class. */
  dualClassId?: number;
  level: number;
  exp: number;
  /** Remort tier: 0 = not tiered. A tiered character plays a base-2..50 track on the tier class. */
  tier?: number;
  /** Exp banked at the moment of tiering (kept as a record of pre-tier progress). */
  tierExp?: number;
  alignment: number;
  stats: Stats;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  move: number;
  maxMove: number;
  gold: number;
  practices: number;
  /** Glory (quest points): earned from quests and glorious kills, spent on practice sessions (§3.6). */
  glory: number;
  /** The character's one active hunt quest, if any. */
  quest?: QuestTarget;
  /** Clan membership (name + rank), if any (systems-spec §5). */
  clan?: { name: string; rank: "leader" | "officer" | "member" };
  /** Opted in to player-vs-player combat. */
  pk: boolean;
  /** Transient (not persisted): the character id of this character's group leader (self = leader). */
  groupLeaderId?: string;
  /** Transient (not persisted): the character id this character consents to be summoned by (§3.3). */
  consent?: string;
  /** Carried items (minimal inventory for shops). */
  inventory: ItemInstance[];
  /** Worn/wielded gear, keyed by slot (head/body/wield/…). Affects combat while equipped. */
  equipment: Record<string, ItemInstance>;
  /** Per-skill learned% (lowercased skill name -> proficiency), raised by practising/use (§2.6). */
  proficiencies: Record<string, number>;
  /** Position doubles as combat stance (standing/resting/sleeping/berserk/…). */
  position: string;
  roomVnum: number;
  title?: string;
  /** Active spell affects (buffs/debuffs). Transient — not persisted; reset to [] on load. */
  affects: Affect[];
}

/** v1 playable set (per architecture-plan §7.2). Widen later. */
export const V1_RACES = ["Human", "Ghoul", "Elf"] as const;
export const V1_CLASSES = ["Warrior", "Mage", "Cleric"] as const;

/** SMAUG's default stat baseline before racial modifiers. */
const BASE_STAT = 13;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** A gentle stat modifier around the 13 baseline; the full app-tables land in Phase 3. */
export function statMod(value: number): number {
  return Math.floor((value - 13) / 2);
}

/** Starting stats = baseline + racial adjustments. */
export function rollStartingStats(racePlus: Partial<Stats>): Stats {
  const base: Stats = {
    str: BASE_STAT,
    int: BASE_STAT,
    wis: BASE_STAT,
    dex: BASE_STAT,
    con: BASE_STAT,
    cha: BASE_STAT,
    lck: BASE_STAT,
  };
  return {
    str: base.str + (racePlus.str ?? 0),
    int: base.int + (racePlus.int ?? 0),
    wis: base.wis + (racePlus.wis ?? 0),
    dex: base.dex + (racePlus.dex ?? 0),
    con: base.con + (racePlus.con ?? 0),
    cha: base.cha + (racePlus.cha ?? 0),
    lck: base.lck + (racePlus.lck ?? 0),
  };
}

export interface StartingVitals {
  maxHp: number;
  maxMana: number;
  maxMove: number;
}

/** Level-1 vitals derived from class flavor + constitution/intelligence. v1 tuning. */
export function startingVitals(
  world: World,
  classId: number,
  stats: Stats,
): StartingVitals {
  const cls = world.classes.get(classId);
  const hpGainMin = cls?.hpGainMin ?? 8;
  const manaGain = cls?.manaGain ?? 0;
  const maxHp = Math.max(15, 18 + hpGainMin + statMod(stats.con) * 2);
  const maxMana = manaGain > 0 ? Math.max(15, 45 + statMod(stats.int) * 3) : 15;
  const maxMove = 100 + statMod(stats.dex) * 2;
  return { maxHp, maxMana, maxMove };
}

export interface CreateCharacterInput {
  id: string;
  accountId: string;
  name: string;
  raceId: number;
  classId: number;
  /** Optional dual-class pick; ignored unless it's a valid, different, race-allowed base class. */
  secondClassId?: number;
  startRoom: number;
}

/** Resolve a requested second class to a valid dual-class id, or undefined (single-class). */
export function resolveDualClass(
  world: World,
  race: RaceDef | undefined,
  classId: number,
  secondClassId: number | undefined,
): number | undefined {
  if (secondClassId == null || secondClassId === classId) return undefined;
  const second = world.classes.get(secondClassId);
  if (!second || second.tiered) return undefined; // tier classes aren't creation choices
  if (race && !raceAllowsClass(race, second.name)) return undefined; // race must allow it too
  return secondClassId;
}

/** The dual (second) class name, or undefined for a single-class character. */
export function dualClassName(world: World, ch: Character): string | undefined {
  if (ch.dualClassId == null || ch.dualClassId === ch.classId) return undefined;
  return world.classes.get(ch.dualClassId)?.name;
}

/** Is this a tiered (remorted) character? */
export function isTiered(ch: Character): boolean {
  return (ch.tier ?? 0) > 0;
}

/** Combat/casting level: tiered characters act at 50 + level/10 (systems-spec §2.4), else raw level. */
export function effectiveLevel(ch: Character): number {
  return isTiered(ch) ? 50 + Math.floor(ch.level / 10) : ch.level;
}

/** Build a fresh level-1 character (full vitals). Caller persists it. */
export function createCharacter(world: World, input: CreateCharacterInput): Character {
  const race = world.races.get(input.raceId);
  const cls = world.classes.get(input.classId);
  const dualClassId = resolveDualClass(world, race, input.classId, input.secondClassId);
  const stats = rollStartingStats(race?.statPlus ?? {});
  const vit = startingVitals(world, input.classId, stats);
  const title = cls?.titles.find((t) => t.level === 1)?.male ?? cls?.name;
  // Racial mana bonus (e.g. Elf +10, Ghoul +50) folds into the starting mana pool.
  const maxMana = Math.max(0, vit.maxMana + (race?.manaPlus ?? 0));
  // Starting alignment is the race default, clamped to the race's allowed band.
  const alignment = clamp(race?.align ?? 0, race?.minAlign ?? -1000, race?.maxAlign ?? 1000);
  return {
    id: input.id,
    accountId: input.accountId,
    name: input.name,
    raceId: input.raceId,
    classId: input.classId,
    dualClassId,
    level: 1,
    exp: 0,
    alignment,
    stats,
    hp: vit.maxHp,
    maxHp: vit.maxHp,
    mana: maxMana,
    maxMana,
    move: vit.maxMove,
    maxMove: vit.maxMove,
    gold: 0,
    practices: 5,
    glory: 0,
    pk: false,
    inventory: [],
    equipment: {},
    proficiencies: {},
    position: "standing",
    roomVnum: input.startRoom,
    title,
    affects: [],
  };
}

/** Carry limits (systems-spec §4.6): STR drives max weight, level a modest item count. */
export function carryLimits(ch: Character): { maxWeight: number; maxItems: number } {
  return { maxWeight: 50 + ch.stats.str * 12, maxItems: 25 + Math.floor(ch.level / 3) };
}

/** exp needed to *reach* the given level: level^3 * 0.95 * class exp_base (systems-spec §2.1). */
export function expToReach(world: World, classId: number, level: number): number {
  const base = world.classes.get(classId)?.expBasePerLevel ?? 100;
  return Math.floor(level ** 3 * 0.95 * base);
}

/** exp remaining until the next level (never negative). */
export function expToNextLevel(world: World, ch: Character): number {
  return Math.max(0, expToReach(world, ch.classId, ch.level + 1) - ch.exp);
}

/** A race may take a class only if it's in its allowed set and not in its restricted set. */
export function raceAllowsClass(race: RaceDef, className: string): boolean {
  return !race.restrictedClasses.includes(className) && race.allowedClasses.includes(className);
}

export function raceName(world: World, ch: Character): string {
  return world.races.get(ch.raceId)?.name ?? "unknown";
}

export function className(world: World, ch: Character): string {
  return world.classes.get(ch.classId)?.name ?? "unknown";
}
