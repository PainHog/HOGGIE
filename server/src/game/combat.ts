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
import { statMod, expToReach, type Character } from "./character.ts";
import { mobShort, type MobInstance } from "./mobInstance.ts";
import { Rng, rng as defaultRng } from "./rng.ts";
import { PlayerFighter, MobFighter, type Fighter } from "./fighter.ts";

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
  }

  /** A single strike: to-hit, then damage + RIS + lucky crit, then messaging and possible death. */
  oneHit(attacker: Fighter, victim: Fighter): void {
    // --- to-hit (ascending score) ---
    let hitScore =
      45 + (attacker.level + attacker.thac0Mod + attacker.profBonus) + Math.floor(attacker.hitroll / 5);
    hitScore += statMod(attacker.stats.lck); // LCK: luckier attacker connects more

    let victimAc = -Math.max(50, Math.abs(Math.trunc(victim.ac / 10)));
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

    // --- damage ---
    let dam = attacker.rollBaseDamage(this.rng) + attacker.damroll + Math.trunc(attacker.profBonus / 10);
    dam = dam * stanceMult(attacker.position) * stanceMult(victim.position);
    if (victim.position === "sleeping") dam *= 2;
    dam = Math.max(1, Math.floor(dam));
    dam = this.risFilter(victim, dam, attacker.damageType);

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

    if (victim.hp <= 0) this.handleDeath(attacker, victim);
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
    if (killer.isPlayer) {
      const ch = (killer as PlayerFighter).character;
      const xp = this.computeXp(ch, mob);
      const gold = mob.proto.gold;
      ch.exp += xp;
      ch.gold += gold;
      killer.send(`&YYou gain ${xp} experience points.&D`);
      if (gold > 0) killer.send(`&YYou get ${gold} gold coins from the corpse of ${mobShort(mob)}.&D`);
      this.checkLevel(killer as PlayerFighter);
    }
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

    // Exp loss for L5-49 (systems-spec §3.5); v1 newbies (<5) lose nothing.
    if (ch.level >= 5 && ch.level < 50) {
      const floorExp = expToReach(this.world, ch.classId, ch.level);
      ch.exp = Math.max(floorExp, ch.exp - ch.level * 75);
    }

    // Respawn: resting, minimal vitals, at the start room (recall hub is roadmap).
    ch.position = "resting";
    ch.hp = 1;
    ch.mana = 1;
    ch.move = 1;
    const dest = this.config.startRoom;
    const prev = ch.roomVnum;
    if (prev !== dest) {
      // relocate the live player
      const player = this.live.roomPlayers(prev).find((p) => p.character.id === ch.id);
      if (player) this.live.moveTo(player, dest);
      else ch.roomVnum = dest;
    }
    playerF.send("&YYou awaken, weak but alive, in a familiar place.&D");
    playerF.afterRound();
  }

  /** exp per kill (systems-spec §2.2). */
  private computeXp(ch: Character, mob: MobInstance): number {
    let xp = (mob.proto.level - ch.level + 10) * 10 + mob.proto.level * 2;
    xp += ch.alignment !== mob.proto.alignment ? 25 : -25;
    const race = this.world.races.get(ch.raceId);
    if (race) xp = Math.floor((xp * race.expMultPct) / 100);
    xp += this.rng.range(-15, 30);
    if (mob.proto.level - ch.level < -9) xp = 1;
    return Math.max(1, xp);
  }

  /** Level up while enough exp and under the mortal cap (systems-spec §2.3). */
  private checkLevel(playerF: PlayerFighter): void {
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
