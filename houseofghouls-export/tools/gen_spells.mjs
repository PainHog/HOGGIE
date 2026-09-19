/**
 * Classify the extracted spells into gameplay categories for the rebuild's casting engine.
 * Input:  content/skills.json (the MINE-audited learnables; spell names/mana/target are content).
 * Output: content/spells.json — one row per Spell: { name, category, damageType, mana, difficulty }.
 *
 * This is a fresh heuristic classifier over the spell NAME and SMAUG target code (1=offensive,
 * 2=defensive, 3=self, 4=object). It copies no SMAUG handler logic — only sorts the game's own
 * spell list into buckets the engine's own formulas act on. Re-run: node tools/gen_spells.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(dir, "..", "content");
const skills = JSON.parse(fs.readFileSync(path.join(content, "skills.json"), "utf8"));

const has = (name, ...ws) => ws.some((w) => name.includes(w));

/** Damage class from the spell name (maps to the RIS damage types the engine already knows). */
function damageType(n) {
  if (has(n, "fire", "flame", "burn", "immol", "hell", "meteor", "incin", "lava", "sun")) return "fire";
  if (has(n, "cold", "frost", "ice", "chill", "freez", "winter", "glacial")) return "cold";
  if (has(n, "lightning", "shock", "electr", "spark", "thunder", "storm")) return "electricity";
  if (has(n, "acid", "corros", "melt")) return "acid";
  if (has(n, "poison", "venom", "toxic", "plague", "disease")) return "poison";
  if (has(n, "drain", "harm", "wither", "decay", "cause", "wound", "negative", "vampiric")) return "drain";
  return "energy"; // generic magic (magic missile, blast, bolt, etc.)
}

const HEAL = ["cure", "heal", "mend", "renew", "restore", "regenera", "recover"];
const DEBUFF = ["blind", "curse", "weaken", "poison", "slow", "feeble", "plague", "faerie fire",
  "silence", "sleep", "charm", "hold", "paralyz", "fear", "wither", "disease", "venom", "web",
  "entangle", "confus", "hex"];
const BUFF = ["armor", "bless", "shield", "strength", "protection", "sanctuar", "refresh", "detect",
  "fly", "haste", "frenzy", "stone", "bark", "infra", "invis", "shroud", "aid", "heroism", "might",
  "resist", "aura", "guard", "ward", "bless", "enchant person", "giant", "float", "speed"];
const UTILITY_SELF = ["recall", "teleport", "gate", "summon", "portal", "astral", "word of recall",
  "locate", "scry", "farsight", "vision", "knock", "dispel", "identify", "enchant", "continual light"];

function classify(sp) {
  const n = sp.name.toLowerCase();
  const t = sp.target; // 1 offensive, 2 defensive, 3 self, 4 object, undefined special
  // heals first (defensive restorative)
  if (has(n, ...HEAL) && !has(n, "cause")) return { category: "heal", damageType: "none" };
  // object/self utility
  if (t === 4 || has(n, ...UTILITY_SELF)) return { category: "utility", damageType: "none" };
  // defensive buffs
  if (t === 2 || t === 3 || has(n, ...BUFF)) {
    if (has(n, ...DEBUFF) && t === 1) return { category: "debuff", damageType: "none" };
    return { category: "buff", damageType: "none" };
  }
  // offensive: debuff vs. direct damage
  if (has(n, ...DEBUFF)) return { category: "debuff", damageType: damageType(n) === "energy" ? "none" : damageType(n) };
  // default offensive → direct damage
  return { category: "damage", damageType: damageType(n) };
}

const rows = [];
for (const sp of skills) {
  if (sp.type !== "Spell") continue;
  const mana = Number.isFinite(sp.mana) ? sp.mana : 15;
  const { category, damageType: dt } = classify(sp);
  rows.push({
    name: sp.name,
    category,
    damageType: dt,
    mana,
    difficulty: Math.max(1, Math.min(12, Math.floor(mana / 8) + 1)),
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(content, "spells.json"), JSON.stringify(rows, null, 1) + "\n");

const byCat = {};
for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
console.log(`wrote ${rows.length} spells:`, JSON.stringify(byCat));
