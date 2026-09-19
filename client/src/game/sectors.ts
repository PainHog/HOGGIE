/**
 * Sector atmosphere: a subtle backdrop tint + ground color per room sector, so the scene reads
 * differently in a forest vs. a dungeon vs. a city — data-driven from the room's own sector, no
 * per-room art. Tints are applied as a low-opacity overlay over the arena.
 */
export interface SectorTheme {
  tint: string; // atmosphere wash over the arena (rendered at low opacity)
  ground: string; // the ground-shadow ellipse color
  label: string; // human label for the sector chip
}

const DEFAULT: SectorTheme = { tint: "#1b1e26", ground: "#000000", label: "somewhere" };

export const SECTOR_THEME: Record<string, SectorTheme> = {
  inside: { tint: "#20222b", ground: "#050505", label: "inside" },
  city: { tint: "#332a17", ground: "#0a0700", label: "city" },
  underground: { tint: "#1a1426", ground: "#04030a", label: "underground" },
  forest: { tint: "#132214", ground: "#040a04", label: "forest" },
  field: { tint: "#23260f", ground: "#080a02", label: "field" },
  hills: { tint: "#1f2410", ground: "#070a03", label: "hills" },
  mountain: { tint: "#22262e", ground: "#06080b", label: "mountain" },
  desert: { tint: "#2f2712", ground: "#0a0800", label: "desert" },
  swamp: { tint: "#16220f", ground: "#040a03", label: "swamp" },
  air: { tint: "#1c2836", ground: "#04070c", label: "air" },
  water_swim: { tint: "#102530", ground: "#020a0e", label: "water" },
  water_noswim: { tint: "#0e2029", ground: "#02080c", label: "deep water" },
  underwater: { tint: "#0b1e2c", ground: "#01070c", label: "underwater" },
  oceanfloor: { tint: "#09171f", ground: "#010508", label: "ocean floor" },
  boat: { tint: "#241a10", ground: "#080500", label: "aboard" },
  somewhere: DEFAULT,
};

export function sectorTheme(sector: string | undefined): SectorTheme {
  return (sector && SECTOR_THEME[sector]) || DEFAULT;
}
