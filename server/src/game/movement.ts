/**
 * Movement cost (systems-spec §3.1): each step out of a room spends `move` by the room's sector
 * cost, scaled by encumbrance (how full your pack is vs your carry limit). Out of `move` → too
 * exhausted to go. Formulas mirror the source's movement_loss table and encumbrance() ladder.
 */

/** Move points to leave a room of a given sector (systems-spec §3.1). Unknown sectors → 2. */
const SECTOR_MOVE_COST: Record<string, number> = {
  inside: 1, city: 2, field: 2, forest: 3, hills: 4, water_swim: 4, underground: 4,
  mountain: 6, underwater: 6, desert: 6, oceanfloor: 7, air: 10, water_noswim: 1,
  swamp: 4, boat: 2, somewhere: 1,
};

export function sectorMoveCost(sector: string): number {
  return SECTOR_MOVE_COST[sector] ?? 2;
}

/** Encumbrance multiplier: the fuller the pack, the more each step costs (source's ladder). */
export function encumbranceMult(carried: number, maxCarry: number): number {
  if (maxCarry <= 0) return 1;
  const f = carried / maxCarry;
  if (f >= 1.0) return 4;
  if (f >= 0.95) return 3.5;
  if (f >= 0.90) return 3;
  if (f >= 0.85) return 2.5;
  if (f >= 0.80) return 2;
  if (f >= 0.75) return 1.5;
  return 1;
}

/** Total move points to leave a room of `sector` while carrying `carried` of `maxCarry`. */
export function moveCost(sector: string, carried: number, maxCarry: number): number {
  return Math.max(1, Math.floor(sectorMoveCost(sector) * encumbranceMult(carried, maxCarry)));
}
