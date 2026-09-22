/**
 * Wire protocol shared by the game server and every client.
 * One JSON envelope per message; `t` is the discriminant.
 *
 * Phase 1: ping / echo (connection loop).
 * Phase 2: auth, character create/select, movement, presence — the shared world.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 11 as const;

/** Max characters accepted in any single inbound text field (abuse guard). */
export const MAX_TEXT = 4000;

// ---------------------------------------------------------------------------
// Color spans — narrative text carries the legacy `&`-color codes; the server
// parses them to spans so clients render style without knowing the code table.
// ---------------------------------------------------------------------------

export type Span = { text: string; color?: string };
/** One rendered line = an ordered run of spans. */
export type Line = Span[];

/** Legacy `&`-code -> semantic color token (themed by the client). */
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

/** Parse one raw string (no newlines expected) into color spans. `&&` is a literal `&`. */
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
      if (code === "&") {
        text += "&";
        i++;
        continue;
      }
      if (code in COLOR_CODES) {
        push();
        color = COLOR_CODES[code];
        i++;
        continue;
      }
    }
    text += ch;
  }
  push();
  return spans;
}

/** Split a raw multi-line string into color-parsed lines. */
export function toLines(raw: string): Line[] {
  return raw.replace(/\r/g, "").split("\n").map(parseColorSpans);
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("echo"), text: z.string().max(MAX_TEXT) }),
  /** A Supabase access token (JWT) to authenticate this connection. */
  z.object({ t: z.literal("auth"), token: z.string().min(1).max(MAX_TEXT) }),
  /** Ask for this account's characters (the select screen). */
  z.object({ t: z.literal("char_list") }),
  /** Create a character and enter the world with it. */
  z.object({
    t: z.literal("char_create"),
    name: z.string().min(2).max(20),
    raceId: z.number().int(),
    classId: z.number().int(),
    /** Optional dual-class pick (validated server-side; ignored if not a valid second class). */
    secondClassId: z.number().int().optional(),
  }),
  /** Select an existing character and enter the world. */
  z.object({ t: z.literal("char_select"), characterId: z.string().uuid() }),
  /** A raw command line, parsed server-side (movement, say, look, who, quit…). */
  z.object({ t: z.literal("cmd"), raw: z.string().max(MAX_TEXT) }),
  /**
   * Presentation-only: engage the mob with this instance id in the current room.
   * A visual client's "click-to-engage" — resolves to the same fight the `kill`
   * command starts; it does not add any new combat behaviour.
   */
  z.object({ t: z.literal("target"), mobId: z.string().min(1).max(64) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/** Compact character summary for the select screen. */
export interface CharacterSummary {
  id: string;
  name: string;
  race: string;
  className: string;
  level: number;
}

/** A selectable race for the creation screen — data-driven, so the client never hardcodes the list. */
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
  description: string; // captured now (help prose); surfaced as tooltips in a later pass
}

/** A selectable class for the creation screen. */
export interface ClassInfo {
  id: number;
  name: string;
  description: string;
  attrPrime?: string; // primary attribute (e.g. "strength")
  learnableCount: number; // how many skills/spells the class can learn over its career
}

/** The character-creation catalog (what races/classes the server currently allows). */
export interface Catalog {
  races: RaceInfo[];
  classes: ClassInfo[];
}

/** One walkable exit from a room (direction + destination vnum for the minimap graph). */
export interface RoomExit {
  dir: string;
  toVnum: number;
  /** A closed door blocks this exit until opened (systems-spec §4.7). */
  closed?: boolean;
}

/**
 * A creature standing in a room, enriched for the visual scene. Presentation-only:
 * every field is derived from existing world state, none of it changes combat.
 */
export interface RoomMob {
  id: string; // mob instance id — the click-to-engage / targeting handle
  name: string; // short description, plain text
  level: number;
  hpPct: number; // current/max, 0..1 (for the token health bar)
  position: string; // standing / resting / sleeping / dead …
  keywords: string[]; // for client-side icon mapping (rat -> rat icon, …)
  effects?: string[]; // status-effect keys — spell-ready, empty in v1
  shopkeeper?: boolean; // true when this mob runs a shop (drives the in-scene Trade affordance)
  // Service-NPC roles, so the client can offer the right tap-actions (talk/quest/heal/train/bank).
  questmaster?: boolean;
  healer?: boolean;
  trainer?: boolean;
  banker?: boolean;
}

/** The player's active quest, surfaced so the client can render a quest card with action buttons. */
export interface QuestBrief {
  kind: "hunt" | "fetch";
  target: string; // the mob to slay or the item to recover
  area: string; // where to seek it
  killed?: number; // hunt progress
  count?: number; // hunt goal
  fulfilled: boolean; // objective met — ready to turn in
  rewardGold: number;
  rewardGlory: number;
  rewardExp: number;
  minutesLeft?: number; // time remaining before it lapses
}

/** Another player present in the room, lightly enriched for the scene. */
export interface RoomPlayerLite {
  id: string; // character id
  name: string;
  level: number;
  effects?: string[]; // status-effect keys — spell-ready, empty in v1
}

/** Structured room snapshot for the client's room/exits panel and visual scene. */
export interface RoomView {
  vnum: number;
  name: string;
  sector: string;
  exits: RoomExit[];
  players: RoomPlayerLite[]; // other characters present
  mobs: RoomMob[]; // creatures present
  items: string[]; // ground item short descriptions
}

/** Character vitals for the character panel. */
export interface Vitals {
  name: string;
  level: number;
  race: string;
  className: string;
  dualClassName?: string; // the second class name for a dual-class character
  tier?: number; // remort tier (0/undefined = not tiered); level then reads on the tier track
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  move: number;
  maxMove: number;
  exp: number;
  tnl: number; // exp to next level
  gold: number;
  glory?: number; // quest points (glory), spent on practice sessions
  clan?: string; // clan name, if any
  pk?: boolean; // opted in to player-vs-player combat
  position: string;
  alignment: number;
  /** Core attributes (LCK included) for the character panel — read-only view of character.stats. */
  stats: { str: number; int: number; wis: number; dex: number; con: number; cha: number; lck: number };
  quest?: QuestBrief; // the active quest, if any (drives the quest card)
}

/**
 * A combat visual event, emitted ALONGSIDE the existing narrative text — never instead of it.
 * The numbers are exactly the ones the text already reports; the engine's combat math is
 * untouched. A visual client turns these into floating damage, token hit flashes, health-bar
 * tweens and death animations. `kind` is intentionally open to grow (heal/buff/debuff) when
 * spellcasting is wired; v1 emits only melee hit/miss/death.
 */
export interface CombatFx {
  kind: "hit" | "miss" | "death";
  sourceId: string; // attacker fighter id (character id or mob instance id)
  targetId: string; // victim fighter id
  targetName: string;
  amount: number; // damage dealt (0 for a miss)
  lucky: boolean; // a lucky crit landed
  fatal: boolean; // this blow dropped the target
  targetHpPct: number; // victim hp after the blow, 0..1
  element?: string; // for spell hits: the damage element (fire/cold/…/magic), tints the fx
}

/** A carried item, resolved for display (name/type/cost from the object prototype). */
export interface InventoryItem {
  vnum: number;
  name: string;
  itemType: string;
  cost: number;
  /** The item's own description prose (empty when the source has none). Surfaced as a tooltip. */
  description: string;
}

/** A worn/wielded item (for the equipment panel). */
export interface EquippedItem {
  slot: string;
  vnum: number;
  name: string;
  itemType: string;
}

/** One line of a shopkeeper's stock, priced for this buyer (CHA-adjusted). */
export interface ShopItem {
  vnum: number;
  name: string;
  itemType: string;
  price: number;
  description: string;
}

/** A shopkeeper's storefront, for the tap-to-buy shop modal. */
export interface ShopView {
  keeper: string;
  items: ShopItem[];
}

/** One learnable skill/spell on a character's class tree, with its help prose for tooltips. */
export interface SkillInfo {
  name: string;
  type: string; // Spell | Skill | Tongue | Weapon
  level: number; // level it unlocks
  adept: number; // practice cap (%)
  learned?: number; // the character's current learned% (0 until unlocked; base until practised)
  available: boolean; // level <= character level
  description: string;
  mana?: number; // MP cost for a spell
  category?: "damage" | "heal" | "buff" | "debuff" | "utility"; // spell effect kind (castable in combat)
}

export type ServerMessage =
  | { t: "welcome"; connectionId: string; server: string; protocol: number }
  | { t: "pong" }
  | { t: "echo"; text: string }
  | { t: "auth_ok"; accountId: string; email: string | null }
  | { t: "auth_error"; message: string }
  | { t: "char_list"; characters: CharacterSummary[] }
  /** The creation catalog (races + classes the server allows), sent at the choosing phase. */
  | { t: "catalog"; catalog: Catalog }
  | { t: "entered"; character: CharacterSummary }
  /** Scrolling narrative (color-parsed). Each entry is one line. */
  | { t: "output"; lines: Line[] }
  | { t: "room"; room: RoomView }
  | { t: "vitals"; vitals: Vitals }
  /** The player's carried items (for the inventory panel). */
  | { t: "inventory"; items: InventoryItem[] }
  /** The player's worn/wielded gear (for the equipment panel). */
  | { t: "equipment"; items: EquippedItem[] }
  /** The character's class skill/spell tree (union of both classes when dual), for the skills panel. */
  | { t: "skills"; label: string; skills: SkillInfo[] }
  /** A shopkeeper's priced stock, sent alongside the `list` narrative for the tap-to-buy modal. */
  | { t: "shop"; shop: ShopView }
  /** Presentation-only combat event, paired with the narrative it visualises. */
  | { t: "fx"; fx: CombatFx }
  | { t: "system"; text: string }
  | { t: "error"; message: string };

/** Parse + validate an inbound frame. Returns null on any malformed input. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function encode(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
