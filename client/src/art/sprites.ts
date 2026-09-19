/**
 * Kenney "Tiny Dungeon" (CC0) sprite sheet — 16×16 tiles, 12 columns × 11 rows (132 tiles),
 * bundled locally at client/assets/kenney/tiny-dungeon.png. Tile indices below were identified
 * from the pack's own preview. CC0 needs no attribution; we credit it anyway (see ASSETS.md).
 */
export const SHEET_TILE = 16;
export const SHEET_COLS = 12;
export const SHEET_W = 192;
export const SHEET_H = 176;

/** Named tiles used by the scene (index into the sheet, row-major). */
export const TILE = {
  // floors
  floorStone: 40, // grey flagstone
  floorTan: 48, // sand/flag
  floorTanCrack: 51,
  floorPlank: 37,
  // walls
  wallBrick: 14, // grey brick
  wallStone: 28, // dark brick
  wallDark: 13,
  wallCrackGrey: 57,
  // openings / features
  doorClosed: 45, // arched wooden door
  doorArch: 33, // dark open archway
  stairsDown: 31,
  brazier: 29, // standing flame
  torch: 125, // small wall torch
  // props / dressing
  chest: 89,
  chestOpen: 91,
  barrel: 82,
  crate: 66,
  table: 72,
  banner: 41,
  // heroes (class → sprite; fall back to knight)
  heroKnight: 96,
  heroMage: 84,
  heroRanger: 88,
  heroRogue: 112,
  heroBarbarian: 109,
  heroCleric: 100,
  heroWoman: 99,
  // creatures
  skeleton: 121,
  ghost: 108,
  imp: 120,
  spider: 122,
  demon: 110,
  ratlike: 120,
} as const;

/** Choose a hero sprite from a class name (best-effort; defaults to the knight). */
export function heroTileForClass(className: string | undefined): number {
  const c = (className ?? "").toLowerCase();
  if (/mage|conjurer|diabolist/.test(c)) return TILE.heroMage;
  if (/druid|ranger/.test(c)) return TILE.heroRanger;
  if (/thief|thug|jester|rogue/.test(c)) return TILE.heroRogue;
  if (/cleric|shaman|bishop|priest/.test(c)) return TILE.heroCleric;
  if (/monk|barbarian/.test(c)) return TILE.heroBarbarian;
  return TILE.heroKnight; // warrior / champion / default
}

/** Choose a creature sprite from a mob's keywords/name (best-effort; defaults to an imp). */
export function creatureTileFor(keywords: string[], name: string): number {
  const hay = [...keywords, ...name.toLowerCase().split(/\s+/)].map((k) => k.toLowerCase());
  const has = (...ws: string[]) => ws.some((w) => hay.some((h) => h.includes(w)));
  if (has("skeleton", "skull", "bone", "lich", "wight")) return TILE.skeleton;
  if (has("ghost", "spectre", "specter", "wraith", "shade", "spirit", "phantom", "ghoul")) return TILE.ghost;
  if (has("spider", "arachnid", "scorpion")) return TILE.spider;
  if (has("demon", "devil", "fiend", "imp", "hellhound")) return TILE.demon;
  return TILE.imp;
}
