/**
 * Data-driven mapping from world state to icons. Mob tokens pick an icon from their keywords
 * (server-provided) with a humanoid default, so new content needs no code change here — just, if
 * desired, a new keyword row. Stance/stat/action glyphs are fixed roles.
 */
import type { IconName } from "./icons.generated";

const KEYWORD_ICON: { match: string[]; icon: IconName }[] = [
  { match: ["rat", "vermin", "mouse", "rodent", "roach"], icon: "rat" },
  { match: ["dog", "wolf", "hound", "jackal", "hyena", "canine", "mutt", "worg"], icon: "wolf-head" },
  { match: ["snake", "serpent", "viper", "cobra", "adder", "python", "naga"], icon: "snake" },
  { match: ["ghost", "spectre", "specter", "wraith", "shade", "spirit", "phantom", "ghoul", "zombie", "undead", "skeleton", "corpse", "wight", "lich"], icon: "spectre" },
  { match: ["imp", "demon", "devil", "fiend", "hellhound"], icon: "imp" },
  { match: ["guard", "soldier", "knight", "sentry", "watchman", "guardian", "warrior", "legionnaire"], icon: "guards" },
];

/** Choose a token icon for a mob from its keywords + name; falls back to a hooded humanoid. */
export function iconForMob(keywords: string[], name: string): IconName {
  const hay = [...keywords, ...name.toLowerCase().split(/\s+/)].map((k) => k.toLowerCase());
  for (const row of KEYWORD_ICON) {
    if (row.match.some((m) => hay.some((h) => h.includes(m)))) return row.icon;
  }
  return "cowled";
}

/** The five stances, as the server names them (position value). */
export const STANCE_ICON: Record<string, IconName> = {
  berserk: "wolverine-claws",
  aggressive: "crossed-swords",
  standing: "sword-brandish",
  normal: "sword-brandish",
  defensive: "shield",
  evasive: "dodging",
};

export const ICON = {
  player: "player-base",
  hp: "heart-plus",
  mana: "magic-swirl",
  move: "boots",
  gold: "two-coins",
  exp: "laurels",
  inventory: "knapsack",
  slotHead: "spartan-helmet",
  slotBody: "chest-armor",
  slotWeapon: "gladius",
  map: "position-marker",
  flee: "run",
  engage: "gladius",
  death: "tombstone",
} satisfies Record<string, IconName>;
