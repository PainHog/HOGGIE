/**
 * Asset pipeline (Step 5B): extract the exact game-icons.net silhouettes the visual client
 * uses out of the locally-installed @iconify-json/game-icons package, and generate:
 *   src/art/icons.generated.ts   — SVG path geometry, tintable via `currentColor`
 *   src/art/credits.generated.ts — per-icon attribution for the in-app Credits screen
 *
 * Every icon is game-icons.net art under CC BY 3.0 (attribution required). Authors were
 * verified against each icon's canonical game-icons.net page. Kenney (CC0) and the OFL fonts
 * need no attribution. Nothing here reaches the network — the geometry is copied from the
 * npm package into the repo so the assets are bundled locally at $0.
 *
 * Regenerate with:  node scripts/gen-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dir, "..");
const SET = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules/@iconify-json/game-icons/icons.json"), "utf8"),
);

// Author's game-icons.net URL slug for building the canonical per-icon link.
const AUTHOR_SLUG = {
  Delapouite: "delapouite", Lorc: "lorc", sbed: "sbed", Skoll: "skoll", Zeromancer: "zeromancer",
  "Caro Asercion": "caro-asercion", "Carl Olsen": "carl-olsen",
};

// slug -> { author (verified on game-icons.net), title, role (what the client uses it for) }.
const USED = {
  // --- tokens (creatures + the player), keyword-mapped in the client ---
  "player-base":     { author: "Delapouite", title: "Player base",     role: "your own token" },
  "cowled":          { author: "Lorc",       title: "Cowled",          role: "generic humanoid enemy" },
  "rat":             { author: "Delapouite", title: "Rat",             role: "vermin enemy" },
  "wolf-head":       { author: "Lorc",       title: "Wolf head",       role: "canine enemy" },
  "snake":           { author: "Lorc",       title: "Snake",           role: "serpent enemy" },
  "spectre":         { author: "Lorc",       title: "Spectre",         role: "undead / ghost enemy" },
  "imp":             { author: "Lorc",       title: "Imp",             role: "demon enemy" },
  "guards":          { author: "Delapouite", title: "Guards",          role: "guard / soldier enemy" },
  // --- the stance dial (5) ---
  "wolverine-claws": { author: "Delapouite", title: "Wolverine claws", role: "berserk stance" },
  "crossed-swords":  { author: "Lorc",       title: "Crossed swords",  role: "aggressive stance" },
  "sword-brandish":  { author: "Delapouite", title: "Sword brandish",  role: "normal stance" },
  "shield":          { author: "sbed",       title: "Shield",          role: "defensive stance" },
  "dodging":         { author: "Lorc",       title: "Dodging",         role: "evasive stance" },
  // --- combat actions ---
  "run":             { author: "Lorc",       title: "Run",             role: "flee action" },
  "gladius":         { author: "Skoll",      title: "Gladius",         role: "engage action + weapon slot" },
  // --- HUD stat glyphs ---
  "heart-plus":      { author: "Zeromancer", title: "Heart plus",      role: "health" },
  "magic-swirl":     { author: "Lorc",       title: "Magic swirl",     role: "mana" },
  "boots":           { author: "Lorc",       title: "Boots",           role: "movement" },
  "two-coins":       { author: "Delapouite", title: "Two coins",       role: "gold" },
  "laurels":         { author: "Lorc",       title: "Laurels",         role: "experience / level" },
  // --- panels: inventory + equipment slots + map ---
  "knapsack":        { author: "Lorc",       title: "Knapsack",        role: "inventory" },
  "spartan-helmet":  { author: "Delapouite", title: "Spartan helmet",  role: "head equipment slot" },
  "chest-armor":     { author: "Delapouite", title: "Chest armor",     role: "body equipment slot" },
  "position-marker": { author: "Delapouite", title: "Position marker", role: "minimap marker" },
  "tombstone":       { author: "sbed",       title: "Tombstone",       role: "death marker" },
  // --- item-type glyphs (inventory panel, by item_type) ---
  "round-potion":    { author: "Caro Asercion", title: "Round potion",    role: "potion / pill / salve item" },
  "scroll-unfurled": { author: "Lorc",          title: "Scroll unfurled", role: "scroll item" },
  "crystal-wand":    { author: "Lorc",          title: "Crystal wand",    role: "wand item" },
  "wizard-staff":    { author: "Lorc",          title: "Wizard staff",    role: "staff item" },
  "ring":            { author: "Delapouite",    title: "Ring",            role: "treasure / jewelry item" },
  "meat":            { author: "Lorc",          title: "Meat",            role: "food item" },
  "key":             { author: "Lorc",          title: "Key",             role: "key item" },
  "torch":           { author: "Delapouite",    title: "Torch",           role: "light-source item" },
  "locked-chest":    { author: "Lorc",          title: "Locked chest",    role: "container item" },
  // --- extra creature tokens (keyword-mapped) ---
  "bat":             { author: "Delapouite",    title: "Bat",             role: "bat enemy" },
  "spider-alt":      { author: "Carl Olsen",    title: "Spider",          role: "spider / arachnid enemy" },
  "raven":           { author: "Lorc",          title: "Raven",           role: "bird enemy" },
  "dragon-head":     { author: "Lorc",          title: "Dragon head",     role: "dragon / reptile enemy" },
  "orc-head":        { author: "Delapouite",    title: "Orc head",        role: "orc enemy" },
  "ogre":            { author: "Delapouite",    title: "Ogre",            role: "ogre / giant enemy" },
  "troll":           { author: "Skoll",         title: "Troll",           role: "troll enemy" },
  "cat":             { author: "Lorc",          title: "Cat",             role: "feline enemy" },
  "goblin-head":     { author: "Delapouite",    title: "Goblin head",     role: "goblin / kobold enemy" },
};

const viewBox = `0 0 ${SET.width ?? 512} ${SET.height ?? 512}`;

/** Pull every `<path d="…">` out of an iconify body, keeping fill-rule when present. */
function extractPaths(body, slug) {
  const stripped = body.replace(/<path\b[^>]*>/g, "");
  const leftover = stripped.replace(/<\/?g[^>]*>/g, "").trim();
  if (leftover) console.warn(`WARN ${slug}: non-path SVG elements present -> ${leftover.slice(0, 80)}`);
  const paths = [];
  const re = /<path\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(body))) {
    const attrs = m[1];
    const d = /\bd="([^"]*)"/.exec(attrs);
    if (!d) continue;
    const fr = /\bfill-rule="([^"]*)"/.exec(attrs);
    paths.push(fr ? { d: d[1], fillRule: fr[1] } : { d: d[1] });
  }
  return paths;
}

const iconEntries = [];
const credits = [];
const missing = [];

for (const [slug, meta] of Object.entries(USED)) {
  const icon = SET.icons[slug];
  if (!icon) { missing.push(slug); continue; }
  const paths = extractPaths(icon.body, slug);
  if (paths.length === 0) { missing.push(slug + " (no paths)"); continue; }
  iconEntries.push({ slug, paths });
  const authorSlug = AUTHOR_SLUG[meta.author];
  credits.push({
    slug, title: meta.title, author: meta.author, role: meta.role,
    url: `https://game-icons.net/1x1/${authorSlug}/${slug}.html`,
  });
}

if (missing.length) { console.error("MISSING ICONS:", missing.join(", ")); process.exit(1); }

// ---- write icons.generated.ts ----
const iconsBody = iconEntries
  .map((e) => `  ${JSON.stringify(e.slug)}: { paths: ${JSON.stringify(e.paths)} },`)
  .join("\n");
const iconsFile = `/**
 * GENERATED by scripts/gen-icons.mjs — do not edit by hand.
 * SVG geometry for the game-icons.net silhouettes used by the client, copied from the
 * @iconify-json/game-icons package (game-icons.net art, CC BY 3.0). Tinted via the \`fill\`
 * we pass at render time. Attribution for these icons lives in credits.generated.ts and is
 * shown in the in-app Credits screen. Regenerate with: node scripts/gen-icons.mjs
 */
export interface IconPath { d: string; fillRule?: string; }
export interface IconDef { paths: IconPath[]; }

/** All icons share game-icons.net's 512×512 canvas. */
export const ICON_VIEWBOX = ${JSON.stringify(viewBox)};

export const ICONS = {
${iconsBody}
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
`;
fs.mkdirSync(path.join(root, "src/art"), { recursive: true });
fs.writeFileSync(path.join(root, "src/art/icons.generated.ts"), iconsFile);

// ---- write credits.generated.ts ----
credits.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
const artists = [...new Set(credits.map((c) => c.author))].sort();
const creditsBody = credits
  .map((c) => `  { slug: ${JSON.stringify(c.slug)}, title: ${JSON.stringify(c.title)}, author: ${JSON.stringify(c.author)}, role: ${JSON.stringify(c.role)}, url: ${JSON.stringify(c.url)} },`)
  .join("\n");
const creditsFile = `/**
 * GENERATED by scripts/gen-icons.mjs — do not edit by hand.
 * Attribution for the game-icons.net icons the client bundles. game-icons.net art is licensed
 * CC BY 3.0, which REQUIRES crediting the original artist — this list is rendered verbatim in
 * the in-app Credits screen. Each author was verified against the icon's canonical game-icons.net
 * page. Regenerate with: node scripts/gen-icons.mjs
 */
export interface IconCredit { slug: string; title: string; author: string; role: string; url: string; }

export const ICON_LICENSE = { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" };
export const ICON_SOURCE = { name: "game-icons.net", url: "https://game-icons.net/" };

/** The distinct artists whose work is bundled (for the Credits summary line). */
export const ICON_ARTISTS: string[] = ${JSON.stringify(artists)};

/** One row per icon actually used, sorted by artist then title. */
export const ICON_CREDITS: IconCredit[] = [
${creditsBody}
];
`;
fs.writeFileSync(path.join(root, "src/art/credits.generated.ts"), creditsFile);

console.log(`Wrote ${iconEntries.length} icons; ${artists.length} distinct artists: ${artists.join(", ")}`);
