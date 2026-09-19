/**
 * Client-side copy of the wire protocol (kept self-contained so Expo/Metro doesn't need to
 * resolve the server workspace). Must stay in sync with shared/src/protocol.ts.
 */
export const PROTOCOL_VERSION = 5;

export type Span = { text: string; color?: string };
export type Line = Span[];

export interface CharacterSummary {
  id: string;
  name: string;
  race: string;
  className: string;
  level: number;
}

export interface RaceInfo {
  id: number;
  name: string;
  statPlus: { str?: number; int?: number; wis?: number; dex?: number; con?: number; cha?: number; lck?: number };
  resistant: string[];
  susceptible: string[];
  expMultPct: number;
  align: number;
  allowedClasses: string[];
  restrictedClasses: string[];
  description: string;
}

export interface ClassInfo {
  id: number;
  name: string;
  description: string;
  attrPrime?: string;
  learnableCount: number;
}

export interface Catalog {
  races: RaceInfo[];
  classes: ClassInfo[];
}

export interface RoomExit {
  dir: string;
  toVnum: number;
}

export interface RoomMob {
  id: string;
  name: string;
  level: number;
  hpPct: number;
  position: string;
  keywords: string[];
  effects?: string[];
  shopkeeper?: boolean;
}

export interface RoomPlayerLite {
  id: string;
  name: string;
  level: number;
  effects?: string[];
}

export interface RoomView {
  vnum: number;
  name: string;
  sector: string;
  exits: RoomExit[];
  players: RoomPlayerLite[];
  mobs: RoomMob[];
  items: string[];
}

export interface Vitals {
  name: string;
  level: number;
  race: string;
  className: string;
  dualClassName?: string;
  tier?: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  move: number;
  maxMove: number;
  exp: number;
  tnl: number;
  gold: number;
  position: string;
  alignment: number;
  stats: { str: number; int: number; wis: number; dex: number; con: number; cha: number; lck: number };
}

/** A combat visual event, emitted alongside the narrative text (same numbers, presentation-only). */
export interface CombatFx {
  kind: "hit" | "miss" | "death";
  sourceId: string;
  targetId: string;
  targetName: string;
  amount: number;
  lucky: boolean;
  fatal: boolean;
  targetHpPct: number;
  element?: string;
}

export interface InventoryItem {
  vnum: number;
  name: string;
  itemType: string;
  cost: number;
  description: string;
}

export interface SkillInfo {
  name: string;
  type: string;
  level: number;
  adept: number;
  available: boolean;
  description: string;
  mana?: number;
  category?: "damage" | "heal" | "buff" | "debuff" | "utility";
}

export type ServerMessage =
  | { t: "welcome"; connectionId: string; server: string; protocol: number }
  | { t: "pong" }
  | { t: "echo"; text: string }
  | { t: "auth_ok"; accountId: string; email: string | null }
  | { t: "auth_error"; message: string }
  | { t: "char_list"; characters: CharacterSummary[] }
  | { t: "catalog"; catalog: Catalog }
  | { t: "entered"; character: CharacterSummary }
  | { t: "output"; lines: Line[] }
  | { t: "room"; room: RoomView }
  | { t: "vitals"; vitals: Vitals }
  | { t: "inventory"; items: InventoryItem[] }
  | { t: "skills"; label: string; skills: SkillInfo[] }
  | { t: "fx"; fx: CombatFx }
  | { t: "system"; text: string }
  | { t: "error"; message: string };

export type ClientMessage =
  | { t: "auth"; token: string }
  | { t: "char_list" }
  | { t: "char_create"; name: string; raceId: number; classId: number; secondClassId?: number }
  | { t: "char_select"; characterId: string }
  | { t: "cmd"; raw: string }
  | { t: "target"; mobId: string };

/** Semantic color token -> hex used by the log renderer (tuned to the gothic palette). */
export const COLOR_HEX: Record<string, string> = {
  red: "#c8433a",
  green: "#7db34a",
  yellow: "#c9a227",
  blue: "#5a7bb0",
  magenta: "#9a7bc0",
  cyan: "#6aa9b8",
  gray: "#8a8577",
  white: "#e8e0d0",
};

const COLOR_CODES: Record<string, string> = {
  r: "red", R: "red",
  g: "green", G: "green",
  y: "yellow", O: "yellow", Y: "yellow",
  b: "blue", B: "blue",
  m: "magenta", p: "magenta", M: "magenta", P: "magenta",
  c: "cyan", C: "cyan",
  w: "gray", W: "white",
  x: "gray", z: "gray",
  d: "reset", D: "reset",
};

export function parseColorSpans(raw: string): Line {
  const spans: Line = [];
  let text = "";
  let color: string | undefined;
  const push = () => {
    if (text) spans.push(color && color !== "reset" ? { text, color } : { text });
    text = "";
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "&" && i + 1 < raw.length) {
      const code = raw[i + 1]!;
      if (code === "&") { text += "&"; i++; continue; }
      if (code in COLOR_CODES) { push(); color = COLOR_CODES[code]; i++; continue; }
    }
    text += ch;
  }
  push();
  return spans;
}
