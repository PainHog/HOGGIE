/**
 * Item interpretation — turn an extracted ObjPrototype (SMAUG value array + wear flags + applies)
 * into typed gameplay stats the engine uses: a wear slot, weapon dice + damage class, an armour-
 * class bonus, and folded combat modifiers (hitroll/damroll/stats/saves). Fresh code; the numbers
 * are the game's own content. Weapon dice come from values[1]/values[2], armour AC from values[0],
 * and applies from the object's affect list.
 */
import type { AffectMods } from "./affects.ts";
import type { ObjPrototype } from "../world/model.ts";

/** SMAUG wear-flag → the equipment slot we key gear by (one item per slot). */
const WEAR_SLOTS = new Set([
  "light", "finger", "neck", "body", "head", "legs", "feet", "hands", "arms", "shield", "about",
  "waist", "wrist", "ears", "eyes", "wield", "hold", "dual_wield", "back", "face", "ankle", "pride", "aura",
]);

/** AC weight by slot (body/head/legs/about protect more), mirroring the source's apply_ac. */
function slotAcMult(slot: string): number {
  if (slot === "body") return 3;
  if (slot === "head" || slot === "legs" || slot === "about") return 2;
  return 1;
}

const clampMod = (n: number) => Math.max(-50, Math.min(50, Math.trunc(n)));

export interface EquipStats {
  slot: string | null; // null = can't be worn/wielded
  wieldable: boolean; // a weapon that goes in the wield/dual-wield slot
  weapon?: { numDice: number; sizeDice: number; damageType: string };
  acBonus: number; // our-engine AC (higher = better)
  mods: AffectMods; // hitroll/damroll/stat/save modifiers while equipped
}

/** Best-effort melee damage class from the weapon's name/keywords. */
function weaponDamageType(proto: ObjPrototype): string {
  const s = (proto.shortDesc + " " + proto.keywords).toLowerCase();
  if (/mace|hammer|club|staff|flail|maul|cudgel|morningstar|bat\b/.test(s)) return "blunt";
  if (/dagger|dirk|spear|pike|rapier|needle|lance|javelin|stiletto|awl/.test(s)) return "pierce";
  return "slash";
}

/** Fold an object's apply-affects into combat modifiers + any bonus AC. */
function foldApplies(proto: ObjPrototype): { mods: AffectMods; acBonus: number } {
  const mods: AffectMods = {};
  let acBonus = 0;
  const add = (k: keyof AffectMods, v: number) => { mods[k] = clampMod((mods[k] ?? 0) + v); };
  for (const a of proto.affects ?? []) {
    const apply = a.apply.toLowerCase();
    const m = a.modifier;
    switch (apply) {
      case "str": add("str", m); break;
      case "int": add("int", m); break;
      case "wis": add("wis", m); break;
      case "dex": add("dex", m); break;
      case "con": add("con", m); break;
      case "cha": add("cha", m); break;
      case "lck": case "luck": add("lck", m); break;
      case "hitroll": add("hitroll", m); break;
      case "damroll": add("damroll", m); break;
      case "ac": case "armor": acBonus += -m; break; // source: negative AC is better → our positive
      case "save_spell": case "saving_spell": case "save_para": case "save_paralysis":
      case "save_petri": case "save_breath": case "save_rod": case "save_wand":
        add("saveSpell", m); break;
      default: break; // hp/mana/move/weaponspell/… are roadmap
    }
  }
  return { mods, acBonus };
}

/** Interpret an object prototype's equipment stats. */
export function equipStats(proto: ObjPrototype): EquipStats {
  const wearable = (proto.wearFlags ?? []).find((w) => WEAR_SLOTS.has(w));
  const type = proto.itemType;
  const isWeapon = type === "weapon" || type === "artweapon";
  const slot = isWeapon ? "wield" : (wearable ?? null);

  const { mods, acBonus: applyAc } = foldApplies(proto);
  let acBonus = applyAc;
  let weapon: EquipStats["weapon"];

  if (isWeapon) {
    const numDice = Math.max(1, proto.values[1] ?? 1);
    const sizeDice = Math.max(1, proto.values[2] ?? 4);
    weapon = { numDice, sizeDice, damageType: weaponDamageType(proto) };
  } else if ((type === "armor" || type === "worn" || type === "artarmor" || type === "artworn") && slot) {
    acBonus += Math.max(0, proto.values[0] ?? 0) * slotAcMult(slot);
  }

  return { slot, wieldable: isWeapon, weapon, acBonus, mods };
}

/** Can this object be equipped at all? */
export function isEquippable(proto: ObjPrototype): boolean {
  return equipStats(proto).slot != null;
}

export interface EquipTotals {
  acBonus: number;
  mods: Required<AffectMods>;
  weapon?: { numDice: number; sizeDice: number; damageType: string };
}

/** Sum the AC + modifiers of everything worn, and surface the wielded weapon. */
export function equipTotals(
  equipment: Record<string, { vnum: number }>,
  getProto: (vnum: number) => ObjPrototype | undefined,
): EquipTotals {
  const mods: Required<AffectMods> = { hitroll: 0, damroll: 0, ac: 0, saveSpell: 0, str: 0, int: 0, wis: 0, dex: 0, con: 0, cha: 0, lck: 0 };
  let acBonus = 0;
  let weapon: EquipTotals["weapon"];
  for (const [slot, ref] of Object.entries(equipment)) {
    if (!ref) continue;
    const proto = getProto(ref.vnum);
    if (!proto) continue;
    const st = equipStats(proto);
    acBonus += st.acBonus;
    for (const k of Object.keys(mods) as (keyof AffectMods)[]) mods[k] += st.mods[k] ?? 0;
    if (st.weapon && (slot === "wield" || slot === "dual_wield") && !weapon) weapon = st.weapon;
  }
  return { acBonus, mods, weapon };
}
