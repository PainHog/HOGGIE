/**
 * Combat engine — systems-spec §1 & §6, reimplemented fresh.
 *
 *  - Fighting STANCES (berserk/aggressive/standing/defensive/evasive) scale damage dealt AND
 *    taken (the offense/defense dial).
 *  - Ascending TO-HIT score (not descending THAC0) + the house AC handling.
 *  - Damage + RIS (resist halves / immune negates / susceptible amplifies); PLUS-tier bypass
 *    is wired for when weapons are equipped (roadmap).
 *  - LCK is a real factor: it nudges to-hit for attacker and defender and drives lucky crits.
 *  - Rounds are driven by the 2-second tick (see tick.ts). Deaths award xp and can level up.
 */
import { parseColorSpans, type CombatFx, type ServerMessage } from "@hoggie/shared";
import { log } from "../log.ts";
import type { AppConfig } from "../config.ts";
import type { World } from "../world/world.ts";
import type { LiveWorld } from "./liveWorld.ts";
import type { SkillDef } from "../world/model.ts";
import { statMod, expToReach, type Character } from "./character.ts";
import { mobShort, type MobInstance } from "./mobInstance.ts";
import { Rng, rng as defaultRng } from "./rng.ts";
import { PlayerFighter, MobFighter, SHIELD_ELEMENT, type Fighter } from "./fighter.ts";
import { applyAffect, sumMods } from "./affects.ts";
import { buffAffect, debuffAffect, spellDamage, spellHeal } from "./spellbook.ts";
import { makeCorpse, PLAYER_CORPSE_DECAY_MS } from "./ground.ts";
import { buildRoomView, esc, sendEquipment, sendInventory, sendRoom } from "./view.ts";
import type { Db } from "../db/repos.ts";

/** The recall / death temple hub (systems-spec §3.3/§3.5). */
export const RECALL_ROOM = 21001;

/** Stances: the offense/defense dial. Multiplier applies to damage dealt and taken. */
export function stanceMult(position: string): number {
  switch (position) {
    case "berserk": return 1.3;
    case "aggressive": return 1.2;
    case "defensive": return 0.75;
    case "evasive": return 0.6;
    default: return 1.0;
  }
}

/** A stance the player can hold while fighting. */
export const STANCES = ["berserk", "aggressive", "standing", "defensive", "evasive"] as const;

/** Per-round chance (%) that a mob with special attacks unleashes one. */
const SPECIAL_CHANCE = 20;
/** Per-round chance (%) that a caster mob casts a spell. */
const MOB_CAST_CHANCE = 25;
/** Per-round chance (%) that a disarm-capable mob disarms a wielding player. */
const DISARM_CHANCE = 8;

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** A fighter's current health as a 0..1 fraction (for the client's token bars). */
function hpPct(f: Fighter): number {
  return f.maxHp > 0 ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 0;
}

function damVerb(dam: number): string {
  if (dam <= 0) return "miss";
  if (dam <= 3) return "scratch";
  if (dam <= 7) return "hit";
  if (dam <= 14) return "injure";
  if (dam <= 24) return "wound";
  if (dam <= 40) return "maul";
  if (dam <= 60) return "DEVASTATE";
  return "MASSACRE";
}

export class CombatManager {
  private readonly engaged = new Set<Fighter>();
  private readonly mobFighters = new Map<string, MobFighter>();

  constructor(
    private readonly world: World,
    private readonly live: LiveWorld,
    private readonly config: AppConfig,
    private readonly rng: Rng = defaultRng,
    private readonly db: Db | null = null,
  ) {}

  /** Look up (or create) the persistent Fighter wrapper for a mob. */
  fighterForMob(mob: MobInstance): MobFighter {
    let f = this.mobFighters.get(mob.id);
    if (!f) {
      f = new MobFighter(mob);
      this.mobFighters.set(mob.id, f);
    }
    return f;
  }

  isEngaged(f: Fighter): boolean {
    return this.engaged.has(f);
  }

  /** Character ids of players currently in combat (so regen can skip them). */
  engagedPlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const f of this.engaged) if (f.isPlayer && f.fighting) ids.add(f.id);
    return ids;
  }

  /** Begin (or continue) a fight: attacker targets victim; victim retaliates if idle. */
  startFight(attacker: Fighter, victim: Fighter): void {
    attacker.fighting = victim;
    if (attacker.position === "standing" || attacker.position === "resting" || attacker.position === "sleeping") {
      attacker.position = "standing";
    }
    this.engaged.add(attacker);
    if (!victim.fighting) {
      victim.fighting = attacker;
      if (victim.position === "sleeping" || victim.position === "resting") victim.position = "standing";
      this.engaged.add(victim);
    }
  }

  stopFight(f: Fighter): void {
    f.fighting = null;
    this.engaged.delete(f);
    if (!f.isPlayer && f.position !== "dead") {
      const mob = (f as MobFighter).mob;
      mob.position = mob.proto.defaultPosition && mob.proto.defaultPosition !== "dead" ? mob.proto.defaultPosition : "standing";
    }
  }

  /** Stop everyone currently targeting `target`. */
  private stopTargeting(target: Fighter): void {
    for (const f of [...this.engaged]) {
      if (f.fighting === target) this.stopFight(f);
    }
  }

  /** One combat tick (2s): every engaged fighter takes its round. */
  tick(): void {
    for (const f of [...this.engaged]) {
      if (!f.alive) {
        this.engaged.delete(f);
        continue;
      }
      const victim = f.fighting;
      if (!victim || !victim.alive || victim.roomVnum !== f.roomVnum) {
        this.stopFight(f);
        continue;
      }
      this.resolveRound(f, victim);
    }
    // refresh vitals for players still engaged
    for (const f of this.engaged) if (f.isPlayer && f.alive) f.afterRound();
  }

  private resolveRound(attacker: Fighter, victim: Fighter): void {
    if (attacker.position === "sleeping" || attacker.position === "resting" || attacker.position === "dead") return;
    const attacks = Math.max(1, attacker.numAttacks);
    for (let i = 0; i < attacks; i++) {
      if (!attacker.alive || !attacker.fighting || !attacker.fighting.alive) break;
      this.oneHit(attacker, attacker.fighting);
      if (!attacker.fighting?.alive) break;
    }
    // A mob with special attacks may unleash one after its normal round. The roll is only made when
    // the mob actually has specials, so plain mobs keep the exact same deterministic combat.
    if (!attacker.isPlayer && attacker.alive && attacker.specials.length && attacker.fighting?.alive) {
      if (this.rng.percent() <= SPECIAL_CHANCE) this.mobSpecial(attacker as MobFighter, attacker.fighting);
    }
    // A caster mob may cast a spell. Everything here is gated on having a spell list, so plain mobs
    // stay bit-for-bit deterministic (no mana, no cooldown, no roll).
    if (!attacker.isPlayer && attacker.alive && attacker.fighting?.alive) {
      const mf = attacker as MobFighter;
      const spells = this.mobCastable(mf);
      if (spells.length) {
        // Regenerate a little mana each round so a long fight doesn't leave the caster permanently dry.
        mf.mob.mana = Math.min(mf.mob.maxMana, mf.mob.mana + 2 + Math.floor(mf.level / 10));
        if (mf.mob.castRecover) {
          mf.mob.castRecover = false; // spent last round recovering — melee only, no cast this round
        } else if (this.rng.percent() <= MOB_CAST_CHANCE) {
          const before = mf.mob.mana;
          this.mobCast(mf, attacker.fighting, spells);
          if (mf.mob.mana < before) mf.mob.castRecover = true; // only recover after an actual cast
        }
      }
    }
    // A mob with the disarm defense may knock a wielding player's weapon loose. Rolled only when the
    // mob actually has disarm, so plain-mob combat is unaffected.
    if (!attacker.isPlayer && attacker.alive && attacker.defenses.includes("disarm")) {
      const foe = attacker.fighting;
      if (foe?.isPlayer && foe.alive && (foe as PlayerFighter).character.equipment.wield && this.rng.percent() <= DISARM_CHANCE) {
        this.disarm(attacker as MobFighter, foe as PlayerFighter);
      }
    }
  }

  /** The spells a caster mob can cast: its class's spell grants at/under its level (empty for non-casters). */
  mobCastable(mob: MobFighter): SkillDef[] {
    const classId = mob.mob.proto.classId;
    if (classId == null) return [];
    const cls = this.world.classes.get(classId);
    if (!cls || (cls.manaGain ?? 0) <= 0) return []; // only mana-using classes cast
    const lvl = mob.level;
    const out: SkillDef[] = [];
    for (const g of cls.skills) {
      if (g.level > lvl) continue;
      const def = this.world.getSkill(g.skill);
      if (def?.type === "Spell" && def.category && def.category !== "utility") out.push(def);
    }
    return out;
  }

  /** Mana a mob spends to cast: the spell's own cost, or a small level-scaled default. */
  private spellCost(spell: SkillDef, level: number): number {
    return spell.mana && spell.mana > 0 ? spell.mana : 8 + Math.floor(level / 4);
  }

  /** A caster mob casts: heal itself when hurt, else buff itself, else hurl an offensive spell (§2.7).
   *  Only spells it can pay for are considered; casting spends the spell's mana. */
  mobCast(mob: MobFighter, victim: Fighter, spells: SkillDef[]): void {
    const affordable = spells.filter((s) => this.spellCost(s, mob.level) <= mob.mob.mana);
    if (!affordable.length) return; // out of mana this round — falls back to melee
    const spend = (spell: SkillDef) => { mob.mob.mana -= this.spellCost(spell, mob.level); };

    const heals = affordable.filter((s) => s.category === "heal");
    if (mob.hp < mob.maxHp * 0.5 && heals.length) {
      const spell = heals[0]!;
      spend(spell);
      const amt = spellHeal(spell.name, mob.level, this.rng);
      mob.hp = Math.min(mob.maxHp, mob.hp + amt);
      this.roomLine(mob.roomVnum, `&c${cap(mob.name)} chants and its wounds knit closed.&D`, []);
      this.roomFx(mob.roomVnum, { kind: "hit", sourceId: mob.id, targetId: mob.id, targetName: mob.name, amount: 0, lucky: false, fatal: false, targetHpPct: hpPct(mob), element: "magic" });
      return;
    }
    const buffs = affordable.filter((s) => s.category === "buff");
    if (buffs.length && !mob.affects.some((a) => a.kind === "buff") && this.rng.percent() <= 40) {
      const spell = buffs[this.rng.range(0, buffs.length - 1)]!;
      spend(spell);
      applyAffect(mob.affects, buffAffect(spell.name, mob.level));
      this.roomLine(mob.roomVnum, `&c${cap(mob.name)} shrouds itself in ${esc(spell.name)}.&D`, []);
      return;
    }
    const offensive = affordable.filter((s) => s.category === "damage" || s.category === "debuff");
    if (offensive.length) {
      const spell = offensive[this.rng.range(0, offensive.length - 1)]!;
      spend(spell);
      this.castOffensive(mob, victim, spell);
    }
  }

  /**
   * A mob unleashes one special attack (systems-spec §1.6): a knockdown (bash/trip/stun/gouge), a
   * life drain, a heavy harm/flamestrike burst, a curse, or a bonus physical strike. `forceName`
   * selects a specific attack (for tests); otherwise one is chosen from the mob's list.
   */
  mobSpecial(mob: MobFighter, victim: Fighter, forceName?: string): string | null {
    const specials = mob.specials;
    if (!forceName && !specials.length) return null;
    const name = (forceName ?? specials[this.rng.range(0, specials.length - 1)]!).toLowerCase();
    const lvl = mob.level;
    switch (name) {
      case "bash": case "trip": case "stun": case "gouge": {
        this.applySpecial(mob, victim, this.rng.range(1, 6) + Math.floor(lvl / 4), "blunt", name);
        if (victim.alive && victim.isPlayer && victim.position !== "resting" && victim.position !== "sleeping") {
          victim.position = "resting";
          victim.send("&RYou are knocked to the ground! (type 'stand' to get up)&D");
        }
        break;
      }
      case "drain": {
        const dealt = this.applySpecial(mob, victim, 4 + Math.floor(lvl / 2), "energy", "life drain");
        if (dealt > 0) mob.hp = Math.min(mob.maxHp, mob.hp + dealt); // steals the life it took
        break;
      }
      case "harm":
        this.applySpecial(mob, victim, Math.floor(lvl * 1.5) + this.rng.range(1, 8), "energy", "harm");
        break;
      case "flamestrike":
        this.applySpecial(mob, victim, lvl + this.rng.dice(2, 8), "fire", "flamestrike");
        break;
      case "curse":
        applyAffect(victim.affects, debuffAffect("curse", lvl));
        this.message(mob, victim, "", "&mA vile curse settles over you!&D", `&m${cap(mob.name)} curses ${victim.name}.&D`);
        this.roomFx(mob.roomVnum, { kind: "hit", sourceId: mob.id, targetId: victim.id, targetName: victim.name, amount: 0, lucky: false, fatal: false, targetHpPct: hpPct(victim), element: "magic" });
        break;
      default: // kick / punch / bite / claws / … — a bonus physical strike
        this.applySpecial(mob, victim, mob.rollBaseDamage(this.rng) + Math.max(0, mob.damroll), "blunt", name);
    }
    return name;
  }

  /** Apply a special attack's damage (RIS + armour + sanctuary), with messaging, fx and death. */
  private applySpecial(source: Fighter, victim: Fighter, raw: number, type: string, verb: string): number {
    let dam = this.risFilter(victim, Math.max(1, Math.floor(raw)), type);
    if (dam > 0 && victim.wornArmor > 0) dam = Math.max(1, dam - Math.floor(victim.wornArmor / 10));
    if (dam > 0 && victim.sanctuary) dam = Math.max(1, Math.floor(dam / 2));
    dam = Math.max(0, dam);
    victim.hp -= dam;
    this.message(source, victim,
      `&RYour ${verb} strikes ${victim.name} for ${dam}!&D`,
      `&R${cap(source.name)}'s ${verb} hits you for ${dam}!&D`,
      `&r${cap(source.name)}'s ${verb} hits ${victim.name}.&D`);
    this.roomFx(source.roomVnum, { kind: "hit", sourceId: source.id, targetId: victim.id, targetName: victim.name, amount: dam, lucky: false, fatal: victim.hp <= 0, targetHpPct: hpPct(victim), element: type });
    if (victim.hp <= 0) this.handleDeath(source, victim);
    return dam;
  }

  /** A single strike: to-hit, then damage + RIS + lucky crit, then messaging and possible death. */
  oneHit(attacker: Fighter, victim: Fighter): void {
    // --- to-hit (ascending score) ---
    let hitScore =
      45 + (attacker.level + attacker.thac0Mod + attacker.profBonus) + Math.floor(attacker.hitroll / 5);
    hitScore += statMod(attacker.stats.lck); // LCK: luckier attacker connects more

    // Worn/natural AC shifts the to-hit bar: better (more negative) AC makes the target harder to
    // hit, ac 0 is the neutral baseline, and the effect is capped so armour can't make a target
    // untouchable (systems-spec §1.2). (The old form pinned this to a constant, so AC never mattered.)
    let victimAc = -50 - Math.max(-30, Math.min(30, Math.trunc(victim.ac / 10)));
    if (!victim.isPlayer) victimAc += 20; // NPCs are easier to hit
    victimAc -= statMod(victim.stats.lck); // LCK: luckier defender is harder to hit

    const roll = this.rng.percent();
    const hit = roll >= 95 || roll > hitScore + victimAc;
    if (!hit) {
      this.message(attacker, victim, `&wYou miss ${victim.name}.&D`, `&w${cap(attacker.name)} misses you.&D`, `&w${cap(attacker.name)} misses ${victim.name}.&D`);
      this.roomFx(attacker.roomVnum, {
        kind: "miss", sourceId: attacker.id, targetId: victim.id, targetName: victim.name,
        amount: 0, lucky: false, fatal: false, targetHpPct: hpPct(victim),
      });
      return;
    }

    // The blow landed — but the defender may dodge or parry it (mobs carrying that special defense).
    if (this.avoided(attacker, victim)) return;

    // --- damage ---
    let dam = attacker.rollBaseDamage(this.rng) + attacker.damroll + Math.trunc(attacker.profBonus / 10);
    dam = dam * stanceMult(attacker.position) * stanceMult(victim.position);
    if (victim.position === "sleeping") dam *= 2;
    dam = Math.max(1, Math.floor(dam));
    dam = this.risFilter(victim, dam, attacker.damageType);
    // Worn armour absorbs a slice of the blow (systems-spec §1.3), never fully negating it.
    if (dam > 0 && victim.wornArmor > 0) dam = Math.max(1, dam - Math.floor(victim.wornArmor / 10));
    // Sanctuary halves incoming damage (systems-spec §1.5).
    if (dam > 0 && victim.sanctuary) dam = Math.max(1, Math.floor(dam / 2));

    let lucky = false;
    if (dam > 0) {
      const luckyChance = 2 + Math.max(0, statMod(attacker.stats.lck));
      if (this.rng.percent() <= luckyChance) {
        dam = Math.floor(dam * 1.5);
        lucky = true;
      }
    }

    victim.hp -= dam;
    const verb = damVerb(dam);
    const luckyTag = lucky ? " &Y(lucky!)&D" : "";
    if (dam <= 0) {
      this.message(attacker, victim, `&wYour blow has no effect on ${victim.name}!&D`, `&w${cap(attacker.name)}'s blow has no effect on you!&D`, `&w${cap(attacker.name)}'s blow has no effect on ${victim.name}!&D`);
    } else {
      this.message(
        attacker,
        victim,
        `&GYou ${verb} ${victim.name}.${luckyTag}&D`,
        `&R${cap(attacker.name)} ${verb}s you.${luckyTag}&D`,
        `&w${cap(attacker.name)} ${verb}s ${victim.name}.&D`,
      );
    }

    this.roomFx(attacker.roomVnum, {
      kind: "hit", sourceId: attacker.id, targetId: victim.id, targetName: victim.name,
      amount: Math.max(0, dam), lucky, fatal: victim.hp <= 0, targetHpPct: hpPct(victim),
    });

    if (victim.hp <= 0) return this.handleDeath(attacker, victim);
    // Damage shields sear whoever struck (fire/ice/shock) — only mobs carrying the flag have any.
    if (dam > 0 && victim.damageShields.length) this.shieldRetaliate(victim, attacker);
  }

  /**
   * The defender turns a landed blow aside (systems-spec §1.6): dodge (DEX-driven) or parry.
   * Only mobs carrying the special defense roll here, so plain-mob combat is unchanged.
   */
  private avoided(attacker: Fighter, victim: Fighter): boolean {
    const defs = victim.defenses;
    if (!defs.length) return false;
    let chance = 0, verb = "";
    if (defs.includes("dodge")) {
      const c = 6 + statMod(victim.stats.dex) * 2 + Math.floor(victim.level / 8);
      if (c > chance) { chance = c; verb = "dodges"; }
    }
    if (defs.includes("parry")) {
      const c = 5 + Math.floor(victim.level / 6);
      if (c > chance) { chance = c; verb = "parries"; }
    }
    if (chance <= 0) return false;
    if (this.rng.percent() > Math.min(chance, 35)) return false; // capped so it never trivialises a fight
    this.message(attacker, victim,
      `&w${cap(victim.name)} ${verb} your attack.&D`,
      `&wYou ${verb} ${attacker.name}'s attack.&D`,
      `&w${cap(victim.name)} ${verb} ${attacker.name}'s attack.&D`);
    this.roomFx(attacker.roomVnum, { kind: "miss", sourceId: attacker.id, targetId: victim.id, targetName: victim.name, amount: 0, lucky: false, fatal: false, targetHpPct: hpPct(victim) });
    return true;
  }

  /** A mob with the disarm defense knocks a wielding player's weapon into their pack (systems-spec §1.6). */
  private disarm(mob: MobFighter, playerF: PlayerFighter): void {
    const ch = playerF.character;
    const w = ch.equipment.wield;
    if (!w) return;
    delete ch.equipment.wield;
    ch.inventory.push(w);
    playerF.send(`&R${cap(mob.name)} disarms you — you scramble to stow your weapon!&D`);
    const player = this.live.roomPlayers(ch.roomVnum).find((p) => p.character.id === ch.id);
    if (player) { sendEquipment(this.world, player); sendInventory(this.world, player); }
  }

  /** A struck damage-shielded fighter sears its attacker for a small elemental hit (systems-spec §1.5). */
  private shieldRetaliate(shielded: Fighter, striker: Fighter): void {
    const flag = shielded.damageShields[0]!; // deterministic: the first shield
    const type = SHIELD_ELEMENT[flag] ?? "fire";
    let d = this.risFilter(striker, Math.max(1, Math.floor(shielded.level / 4)), type);
    if (d <= 0) return;
    striker.hp -= d;
    this.message(shielded, striker,
      `&RYour ${flag} sears ${striker.name}.&D`,
      `&R${cap(shielded.name)}'s ${flag} sears you for ${d}!&D`,
      `&r${cap(shielded.name)}'s ${flag} sears ${striker.name}.&D`);
    this.roomFx(striker.roomVnum, {
      kind: "hit", sourceId: shielded.id, targetId: striker.id, targetName: striker.name,
      amount: d, lucky: false, fatal: striker.hp <= 0, targetHpPct: hpPct(striker), element: type,
    });
    if (striker.hp <= 0) this.handleDeath(shielded, striker);
  }

  /** The cast-failure roll (systems-spec §2.7): true = the spell fizzles (half mana lost). */
  spellFails(difficulty: number, learned: number): boolean {
    return this.rng.percent() + difficulty * 5 > learned;
  }

  /** HP restored by a heal spell, routed through the combat rng so tests stay deterministic. */
  rollHeal(name: string, level: number): number {
    return spellHeal(name, level, this.rng);
  }

  /** Saving throw vs. a spell (systems-spec §2.7): made save halves damage / resists a debuff. */
  private savedAgainst(target: Fighter, spellLevel: number): boolean {
    const bonus = sumMods(target.affects).saveSpell;
    const savePct = Math.max(5, Math.min(95, 20 + (target.level - spellLevel - bonus)));
    return this.rng.percent() <= savePct;
  }

  /**
   * Resolve an offensive spell (damage or debuff) landing on a target. Mana + the failure roll are
   * charged by the caller (doCast); this applies the effect: saving throw, then RIS for damage or a
   * timed affect for debuffs, with messaging, fx, engagement, and death handling. Fresh formulas.
   */
  castOffensive(caster: Fighter, target: Fighter, spell: SkillDef): { dam: number; killed: boolean } {
    this.startFight(caster, target);
    const level = caster.level;
    if (spell.category === "debuff") {
      if (this.savedAgainst(target, level)) {
        this.message(caster, target, `&c${cap(target.name)} resists your ${spell.name}.&D`, `&cYou resist ${cap(caster.name)}'s ${spell.name}.&D`, `&c${cap(target.name)} resists ${spell.name}.&D`);
        return { dam: 0, killed: false };
      }
      applyAffect(target.affects, debuffAffect(spell.name, level));
      this.message(caster, target, `&mYour ${spell.name} takes hold of ${target.name}.&D`, `&mYou are gripped by ${spell.name}!&D`, `&m${cap(target.name)} is gripped by ${spell.name}.&D`);
      this.roomFx(caster.roomVnum, { kind: "hit", sourceId: caster.id, targetId: target.id, targetName: target.name, amount: 0, lucky: false, fatal: false, targetHpPct: hpPct(target), element: "magic" });
      return { dam: 0, killed: false };
    }
    // direct damage
    let dam = spellDamage(level, this.rng);
    if (this.savedAgainst(target, level)) dam = Math.floor(dam / 2);
    if (target.immune.has("magic")) dam = 0;
    dam = Math.max(0, this.risFilter(target, dam, spell.damageType && spell.damageType !== "none" ? spell.damageType : "energy"));
    target.hp -= dam;
    const el = spell.damageType && spell.damageType !== "none" ? spell.damageType : "magic";
    this.message(
      caster,
      target,
      dam > 0 ? `&mYour ${spell.name} hits ${target.name} for ${dam}.&D` : `&mYour ${spell.name} fizzles against ${target.name}.&D`,
      dam > 0 ? `&R${cap(caster.name)}'s ${spell.name} hits you for ${dam}.&D` : `&m${cap(caster.name)}'s ${spell.name} fizzles against you.&D`,
      `&m${cap(caster.name)}'s ${spell.name} strikes ${target.name}.&D`,
    );
    this.roomFx(caster.roomVnum, { kind: "hit", sourceId: caster.id, targetId: target.id, targetName: target.name, amount: Math.max(0, dam), lucky: false, fatal: target.hp <= 0, targetHpPct: hpPct(target), element: el });
    const killed = target.hp <= 0;
    if (killed) this.handleDeath(caster, target);
    return { dam, killed };
  }

  /** Resist halves, immune negates, susceptible amplifies (systems-spec §1.5). */
  private risFilter(victim: Fighter, dam: number, type: string): number {
    if (victim.immune.has(type) || victim.immune.has("nonmagic")) return 0;
    let out = dam;
    if (victim.resist.has(type) || victim.resist.has("nonmagic")) out = Math.floor(out / 2);
    if (victim.suscept.has(type)) out = Math.floor(out * 1.5);
    return out;
  }

  private handleDeath(killer: Fighter, victim: Fighter): void {
    if (victim.isPlayer) this.playerDies(victim as PlayerFighter, killer);
    else this.mobDies(victim as MobFighter, killer);
  }

  private mobDies(mobF: MobFighter, killer: Fighter): void {
    const mob = mobF.mob;
    const room = mob.roomVnum;
    this.stopTargeting(mobF);
    this.stopFight(mobF);
    this.live.removeMob(mob);
    this.mobFighters.delete(mob.id);

    this.roomLine(room, `&w${cap(mobShort(mob))} is DEAD!!&D`, []);
    this.roomFx(room, {
      kind: "death", sourceId: killer.id, targetId: mob.id, targetName: mobShort(mob),
      amount: 0, lucky: false, fatal: true, targetHpPct: 0,
    });

    // Leave a corpse holding the mob's carried/worn gear (systems-spec §4.7). Gold is picked up
    // automatically; equipment must be looted. No corpse when the mob carried nothing.
    const loot = (this.world.mobLoot.get(mob.proto.vnum) ?? []).filter((v) => this.world.getObjPrototype(v));
    if (loot.length > 0) {
      const kw = mob.proto.keywords.split(/\s+/).find(Boolean) ?? "corpse";
      this.live.addCorpse(room, makeCorpse(mobShort(mob), kw, loot.map((vnum) => ({ vnum }))));
      this.roomLine(room, `&rThe corpse of ${esc(mobShort(mob))} lies here.&D`, []);
      for (const p of this.live.roomPlayers(room)) p.send({ t: "room", room: buildRoomView(this.live, p) });
    }

    if (killer.isPlayer) {
      const killerF = killer as PlayerFighter;
      const ch = killerF.character;

      // Group members present in the room share both the gold and the xp; a solo killer keeps it all.
      const sharers = this.xpSharers(killerF, room);

      // Gold is divided evenly among the sharers; the killer keeps any remainder.
      const gold = mob.proto.gold;
      if (gold > 0) {
        const each = Math.floor(gold / sharers.length);
        const remainder = gold - each * sharers.length;
        for (const f of sharers) {
          const share = each + (f === killerF ? remainder : 0);
          if (share <= 0) continue;
          f.character.gold += share;
          f.send(sharers.length > 1
            ? `&YYour share of the spoils is ${share} gold coins.&D`
            : `&YYou get ${share} gold coins from the corpse of ${mobShort(mob)}.&D`);
        }
      }

      const bonus = sharers.length > 1 ? 1.1 : 1; // grouping is a little more efficient
      for (const f of sharers) {
        const xp = Math.max(1, Math.floor((this.computeXp(f.character, mob) / sharers.length) * bonus));
        f.character.exp += xp;
        f.send(`&YYou gain ${xp} experience points.&D`);
        this.checkLevel(f);
      }

      // Glory: felling a much tougher foe is a glorious deed (§3.6) — to the killer.
      if (mob.proto.level >= ch.level + 5) {
        ch.glory += 1;
        killer.send("&YA glorious kill! (+1 glory)&D");
      }
      // Quest progress: does this kill count toward the killer's active HUNT? (fetch quests are
      // completed by carrying the item, not by kill count.)
      if (ch.quest && (ch.quest.type ?? "hunt") === "hunt" && ch.quest.mobVnum === mob.proto.vnum && ch.quest.killed < ch.quest.count) {
        ch.quest.killed += 1;
        const q = ch.quest;
        killer.send(q.killed >= q.count
          ? `&YQuest complete: ${q.count}/${q.count} ${esc(q.mobName)} slain — return to a questmaster to claim your reward.&D`
          : `&YQuest: ${q.killed}/${q.count} ${esc(q.mobName)} slain.&D`);
      }
    }
  }

  /** The player fighters that share a kill's xp: co-located group members, or just the killer. */
  private xpSharers(killerF: PlayerFighter, room: number): PlayerFighter[] {
    const leaderId = killerF.character.groupLeaderId;
    if (leaderId == null) return [killerF];
    const out: PlayerFighter[] = [];
    for (const p of this.live.roomPlayers(room)) {
      if (p.character.groupLeaderId === leaderId && p.fighter) out.push(p.fighter as PlayerFighter);
    }
    return out.length ? out : [killerF];
  }

  private playerDies(playerF: PlayerFighter, killer: Fighter): void {
    const ch = playerF.character;
    const room = ch.roomVnum;
    this.stopTargeting(playerF);
    this.stopFight(playerF);

    this.roomLine(room, `&R${cap(ch.name)} is DEAD!!&D`, [ch.id]);
    this.roomFx(room, {
      kind: "death", sourceId: killer.id, targetId: ch.id, targetName: ch.name,
      amount: 0, lucky: false, fatal: true, targetHpPct: 0,
    });
    killer.send(`&RYou have slain ${ch.name}!&D`);
    playerF.send("&RYou have been KILLED!&D");
    // A player-vs-player victory is a deed of glory (systems-spec §5).
    if (killer.isPlayer) {
      const winner = (killer as PlayerFighter).character;
      winner.glory += 2;
      killer.send("&YYou have proven yourself in mortal combat! (+2 glory)&D");
    }

    // Exp loss for L5-49 (systems-spec §3.5); v1 newbies (<5) lose nothing.
    if (ch.level >= 5 && ch.level < 50) {
      const floorExp = expToReach(this.world, ch.classId, ch.level);
      ch.exp = Math.max(floorExp, ch.exp - ch.level * 75);
    }

    // Death drops everything you carried into a corpse at the death room (systems-spec §3.5).
    // Newbies (<5) keep their gear so a first death isn't crushing.
    const carried = [...ch.inventory, ...Object.values(ch.equipment ?? {})];
    if (ch.level >= 5 && (carried.length > 0 || ch.gold > 0)) {
      const kw = ch.name.split(/\s+/)[0] ?? "corpse";
      // Clone each instance so the corpse keeps nested contents/open-lock state (not just the vnum).
      this.live.addCorpse(room, makeCorpse(ch.name, kw, carried.map((it) => ({ ...it })), Date.now(), ch.gold, PLAYER_CORPSE_DECAY_MS));
      ch.inventory = [];
      ch.equipment = {};
      ch.gold = 0;
      playerF.send("&RYour corpse and everything you carried are left behind — hurry back for it!&D");
      for (const p of this.live.roomPlayers(room)) p.send({ t: "room", room: buildRoomView(this.live, p) });
    }

    // Respawn: resting, minimal vitals, at the temple (its altar is the death hub); start room if
    // the temple isn't loaded.
    ch.position = "resting";
    ch.hp = 1;
    ch.mana = 1;
    ch.move = 1;
    const dest = this.world.getRoom(RECALL_ROOM) ? RECALL_ROOM : this.config.startRoom;
    const prev = ch.roomVnum;
    const player = this.live.roomPlayers(prev).find((p) => p.character.id === ch.id);
    if (prev !== dest) {
      if (player) this.live.moveTo(player, dest);
      else ch.roomVnum = dest;
    }
    playerF.send("&YYou awaken, weak but alive, at the temple altar.&D");
    if (player) { sendRoom(this.live, player); sendInventory(this.world, player); sendEquipment(this.world, player); }
    playerF.afterRound();
    if (this.db) void this.db.saveCharacter(ch).catch(() => {});
  }

  /**
   * exp per kill (systems-spec §2.2, retuned for a playable curve). The level^3 exp-to-level curve
   * (§2.1) is steep, so a kill is worth ~mob.level*(12+mob.level) — roughly quadratic in the mob's
   * level — keeping kills-per-level bounded (~60–125) across the whole range instead of exploding.
   * A level-difference modifier rewards fighting up and starves grossly-under-level farming.
   */
  private computeXp(ch: Character, mob: MobInstance): number {
    const lvl = Math.max(1, mob.proto.level);
    const diff = mob.proto.level - ch.level;
    let xp = lvl * (12 + lvl); // base scales with the mob's own level
    const mod = Math.max(0.25, Math.min(2, 1 + diff * 0.08)); // +8%/level above you (cap 2x), floor 0.25x
    xp = Math.floor(xp * mod);
    xp += ch.alignment !== mob.proto.alignment ? 25 : -25; // opposed alignment is worth a little more
    const race = this.world.races.get(ch.raceId);
    if (race) xp = Math.floor((xp * race.expMultPct) / 100);
    xp += this.rng.range(-15, 30);
    if (diff < -9) xp = Math.max(1, Math.floor(xp * 0.1)); // grossly under-level = scraps
    return Math.max(1, xp);
  }

  /** Level up while enough exp and under the mortal cap (systems-spec §2.3). */
  checkLevel(playerF: PlayerFighter): void {
    const ch = playerF.character;
    while (ch.level < 50 && ch.exp >= expToReach(this.world, ch.classId, ch.level + 1)) {
      ch.level += 1;
      const cls = this.world.classes.get(ch.classId);
      const hasMana = (cls?.manaGain ?? 0) > 0;
      const tiered = (ch.tier ?? 0) > 0;
      let hpGain: number, manaGain: number, moveGain: number;
      if (tiered) {
        // Re-leveling the tier track: tiny per-level gains (systems-spec §2.4); power is kept.
        hpGain = this.rng.range(1, 4);
        manaGain = hasMana ? this.rng.range(1, 4) : 0;
        moveGain = this.rng.range(1, 4);
      } else {
        const conMod = statMod(ch.stats.con);
        hpGain = Math.max(1, (cls?.hpGainMin ?? 8) + this.rng.range(0, (cls?.hpGainMax ?? 12) - (cls?.hpGainMin ?? 8)) + conMod);
        manaGain = hasMana ? Math.max(1, this.rng.range(Math.floor(ch.stats.int / 2), Math.floor((ch.stats.int + ch.stats.wis) / 2))) : 0;
        moveGain = this.rng.range(10, ch.stats.con + ch.stats.dex);
      }
      ch.maxHp += hpGain;
      ch.maxMana += manaGain;
      ch.maxMove += moveGain;
      const dual = ch.dualClassId != null && ch.dualClassId !== ch.classId;
      ch.practices += Math.max(1, statMod(ch.stats.wis) + 1) + (dual ? 1 : 0); // +1 for dual-class

      ch.hp = ch.maxHp;
      ch.mana = ch.maxMana;
      ch.move = ch.maxMove;
      playerF.send(`&YYou raise a level!! You are now level ${ch.level}.&D`);
    }
  }

  // --- messaging ----------------------------------------------------------
  private message(attacker: Fighter, victim: Fighter, toAtk: string, toVict: string, toRoom: string): void {
    attacker.send(toAtk);
    victim.send(toVict);
    const exclude = [attacker.id, victim.id];
    this.roomLine(attacker.roomVnum, toRoom, exclude);
  }

  private roomLine(vnum: number, line: string, excludeIds: string[]): void {
    const msg: ServerMessage = { t: "output", lines: [parseColorSpans(line)] };
    for (const p of this.live.roomPlayers(vnum)) {
      if (excludeIds.includes(p.character.id)) continue;
      p.send(msg);
    }
  }

  /**
   * Broadcast a structured combat FX to everyone in the room (participants included, since
   * a visual client draws hits on both tokens). Presentation-only — carries the same numbers
   * the narrative already reported; nothing here feeds back into combat resolution.
   */
  private roomFx(vnum: number, fx: CombatFx): void {
    const msg: ServerMessage = { t: "fx", fx };
    for (const p of this.live.roomPlayers(vnum)) p.send(msg);
  }

  /** Remove a disconnecting player's fighter from combat. */
  disengage(f: Fighter): void {
    this.stopTargeting(f);
    this.stopFight(f);
  }

  debugEngagedCount(): number {
    return this.engaged.size;
  }
}
