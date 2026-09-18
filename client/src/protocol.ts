/**
 * Client-side copy of the wire protocol (kept self-contained so Expo/Metro doesn't need to
 * resolve the server workspace). Must stay in sync with shared/src/protocol.ts.
 */
export const PROTOCOL_VERSION = 2;

export type Span = { text: string; color?: string };
export type Line = Span[];

export interface CharacterSummary {
  id: string;
  name: string;
  race: string;
  className: string;
  level: number;
}

export interface RoomView {
  vnum: number;
  name: string;
  sector: string;
  exits: string[];
  players: string[];
  mobs: string[];
  items: string[];
}

export interface Vitals {
  name: string;
  level: number;
  race: string;
  className: string;
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
}

export type ServerMessage =
  | { t: "welcome"; connectionId: string; server: string; protocol: number }
  | { t: "pong" }
  | { t: "echo"; text: string }
  | { t: "auth_ok"; accountId: string; email: string | null }
  | { t: "auth_error"; message: string }
  | { t: "char_list"; characters: CharacterSummary[] }
  | { t: "entered"; character: CharacterSummary }
  | { t: "output"; lines: Line[] }
  | { t: "room"; room: RoomView }
  | { t: "vitals"; vitals: Vitals }
  | { t: "system"; text: string }
  | { t: "error"; message: string };

export type ClientMessage =
  | { t: "auth"; token: string }
  | { t: "char_list" }
  | { t: "char_create"; name: string; raceId: number; classId: number }
  | { t: "char_select"; characterId: string }
  | { t: "cmd"; raw: string };

/** Semantic color token -> CSS hex used by the client renderer. */
export const COLOR_HEX: Record<string, string> = {
  red: "#ff6b6b",
  green: "#69db7c",
  yellow: "#ffd43b",
  blue: "#4dabf7",
  magenta: "#f783ac",
  cyan: "#3bc9db",
  gray: "#adb5bd",
  white: "#f8f9fa",
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
