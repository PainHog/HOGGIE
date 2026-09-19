/**
 * In-memory world-state model.
 *
 * These domain types mirror the Step 1A content (houseofghouls-export/content/*.json) in
 * camelCase. Phase 1 defines the shapes and the (empty) registries only — the loader that
 * fills them from JSON arrives in Phase 2, so widening the world is "add data, not code".
 *
 * Prototypes (Room / MobPrototype / ObjPrototype) are immutable templates keyed by vnum.
 * Live instances (mobs/objects/characters standing in rooms) are spun from prototypes by
 * resets and are added in later phases.
 */

/** The seven House of Ghouls attributes. LCK (luck) is the custom 7th stat. */
export interface Stats {
  str: number;
  int: number;
  wis: number;
  dex: number;
  con: number;
  cha: number;
  lck: number;
}

/** Five saving-throw categories carried on mobs (and later characters). */
export interface Saves {
  saveDamage: number;
  saveWand: number;
  saveParaPetri: number;
  saveBreath: number;
  saveSpellStaff: number;
}

export interface Exit {
  dir: string;
  toVnum: number;
  keyVnum?: number;
  flags?: string[];
  keyword?: string;
}

export interface Room {
  vnum: number;
  area: string;
  name: string;
  description: string;
  sector: string;
  roomFlags: string[];
  exits: Exit[];
  extraDescKeywords?: string[];
  teleport?: { delay: number; toVnum: number };
  tunnel?: number;
  hasRoomprogs?: boolean;
}

export interface MobPrototype {
  vnum: number;
  area: string;
  keywords: string;
  shortDesc: string;
  longDesc: string;
  description: string;
  level: number;
  alignment: number;
  actFlags: string[];
  affectFlags: string[];
  thac0: number;
  ac: number;
  hpDice: string;
  damDice: string;
  gold: number;
  exp: number;
  position: string;
  defaultPosition: string;
  sex: string;
  stats?: Stats;
  saves?: Saves;
  raceId?: number;
  classId?: number;
  height?: number;
  weight?: number;
  numAttacks?: number;
  hitroll?: number;
  damroll?: number;
  resistant: string[];
  immune: string[];
  susceptible: string[];
  specialAttacks: string[];
  specialDefenses: string[];
  simpleMob?: boolean;
  hasMobprogs?: boolean;
}

export interface ObjAffect {
  apply: string;
  modifier: number;
}

export interface ObjPrototype {
  vnum: number;
  area: string;
  keywords: string;
  shortDesc: string;
  description: string;
  actionDesc: string;
  itemType: string;
  extraFlags: string[];
  wearFlags: string[];
  values: number[];
  weight: number;
  cost: number;
  spells?: string[];
  affects?: ObjAffect[];
  extraDescKeywords?: string[];
  hasObjprogs?: boolean;
}

export interface Area {
  file: string;
  name: string;
  author: string;
  version: number;
  levelRange?: {
    softLow: number;
    softHigh: number;
    hardLow: number;
    hardHigh: number;
  };
  areaFlags?: string[];
  resetMsg?: string;
  vnumRange?: [number, number];
}

export interface ClassSkillGrant {
  skill: string;
  level: number;
  adept: number;
}

export interface ClassDef {
  id: number;
  name: string;
  attrPrime?: string;
  attrSecond?: string;
  attrTertiary?: string;
  thac0Base: number;
  thac0Mod: number;
  hpGainMin: number;
  hpGainMax: number;
  manaGain: number;
  expBasePerLevel: number;
  skillAdeptCap: number;
  skills: ClassSkillGrant[];
  titles: { level: number; male: string; female: string }[];
  /** Tier (remort) classes aren't creation choices — they're reached via `advancetier` (§2.4). */
  tiered: boolean;
  tierOf?: string[]; // for a tier class: the base classes that advance into it
  advancesTo?: string; // for a base class: the tier class it becomes
  /** The MUD's own help prose for the class (empty when the source has none). */
  description: string;
}

export interface RaceDef {
  id: number;
  name: string;
  statPlus: Partial<Stats>;
  hitPlus?: number;
  manaPlus?: number;
  acPlus?: number;
  expMultPct: number;
  align: number;
  minAlign: number;
  maxAlign: number;
  resistBits?: number;
  immuneBits?: number;
  susceptBits?: number;
  /** Decoded damage/effect classes this race resists / is susceptible to (systems-spec §1.5). */
  resistant: string[];
  susceptible: string[];
  allowedClasses: string[];
  restrictedClasses: string[];
  /** The MUD's own help prose for the race (empty when the source has no help entry). */
  description: string;
}

/** A shop (systems-spec §4.2): a keeper mob that buys/sells, with markup % and traded item-types. */
export interface ShopDef {
  keeperVnum: number;
  tradeTypes: string[]; // item_type names this shop will BUY from players
  profitBuy: number; // markup % applied to purchases
  profitSell: number; // markup % applied to sales
  openHour: number;
  closeHour: number;
  area: string;
}

/** A world reset: how the area repopulates (spawns mobs, places/gives/equips objects). */
export interface Reset {
  area: string;
  kind:
    | "spawn_mob"
    | "equip_mob"
    | "give_to_mob"
    | "place_object"
    | "put_in_container"
    | "door_state"
    | "other";
  mobVnum?: number;
  objVnum?: number;
  roomVnum?: number;
  containerVnum?: number;
  wearLoc?: string | number;
  maxInWorld?: number;
  door?: number;
  state?: number;
}

/** Skill/spell/tongue/weapon-prof definition. `handlerKey` binds to a fresh TS implementation. */
export interface SkillDef {
  name: string;
  type: string; // Spell | Skill | Tongue | Weapon
  slot?: number;
  mana?: number;
  beats?: number;
  minLevel?: number;
  minPosition?: number;
  target?: number;
  damageNoun?: string;
  flags?: number;
  /** Original SMAUG handler name, kept only as a mapping key to a fresh TS function. */
  handlerKey?: string;
  /** The MUD's own help prose for the skill/spell (empty when the source has none). */
  description: string;
}
