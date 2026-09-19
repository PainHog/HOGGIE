/**
 * The game loop. One authoritative process drives staggered pulses (systems-spec §Foundational):
 *   - combat every 2s (the classic round),
 *   - fast position-based regen every 7s,
 *   - area repop every 60s.
 */
import { out, sendVitals } from "./view.ts";
import { statMod } from "./character.ts";
import { expireAffects } from "./affects.ts";
import type { LiveWorld, Player } from "./liveWorld.ts";
import type { CombatManager } from "./combat.ts";
import { repopWorld } from "./spawn.ts";

const COMBAT_MS = 2_000;
const REGEN_MS = 7_000;
const REPOP_MS = 60_000;

export class GameTick {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly live: LiveWorld,
    private readonly combat: CombatManager,
  ) {}

  start(): void {
    this.timers.push(setInterval(() => this.safe(() => this.combat.tick()), COMBAT_MS));
    this.timers.push(setInterval(() => this.safe(() => this.regen()), REGEN_MS));
    this.timers.push(setInterval(() => this.safe(() => repopWorld(this.live)), REPOP_MS));
    for (const t of this.timers) t.unref?.();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* never let a tick crash the loop */
    }
  }

  /** Fast, position-based regen for players not currently in combat, plus idle mob healing. */
  private regen(): void {
    this.tickAffects();
    const fighting = this.combat.engagedPlayerIds();
    for (const p of this.live.online()) {
      if (fighting.has(p.character.id)) continue;
      this.regenPlayer(p);
    }
    // idle mobs slowly heal back to full
    for (const mob of this.live.allMobs()) {
      if (mob.hp < mob.maxHp && !this.combat.isEngaged(this.combat.fighterForMob(mob))) {
        mob.hp = Math.min(mob.maxHp, mob.hp + Math.max(1, Math.floor(mob.maxHp / 10)));
      }
    }
  }

  /** Expire spell affects (with a "wears off" note) and apply poison-style damage-over-time. */
  private tickAffects(): void {
    const now = Date.now();
    for (const p of this.live.online()) {
      const ch = p.character;
      if (!ch.affects.length) continue;
      for (const gone of expireAffects(ch.affects, now)) out(p, gone.wearOff);
      let dot = 0;
      for (const af of ch.affects) if (af.dot) dot += af.dot.amount;
      if (dot > 0) {
        ch.hp = Math.max(1, ch.hp - dot); // DoT weakens but won't outright kill out of combat
        out(p, `&gYou shudder as poison courses through you. (-${dot} hp)&D`);
      }
      sendVitals(this.live.world, p);
    }
    for (const mob of this.live.allMobs()) {
      if (!mob.affects.length) continue;
      expireAffects(mob.affects, now);
      let dot = 0;
      for (const af of mob.affects) if (af.dot) dot += af.dot.amount;
      if (dot > 0) mob.hp = Math.max(1, mob.hp - dot);
    }
  }

  private regenPlayer(p: Player): void {
    const ch = p.character;
    if (ch.hp >= ch.maxHp && ch.mana >= ch.maxMana && ch.move >= ch.maxMove) return;

    const con = statMod(ch.stats.con);
    const int = statMod(ch.stats.int);
    const dex = statMod(ch.stats.dex);
    const base = Math.max(1, Math.floor(ch.level / 5));

    let hpr = base, mpr = base, mvr = base;
    if (ch.position === "sleeping") {
      hpr += 6 + con; mpr += 6 + int; mvr += 6 + dex;
    } else if (ch.position === "resting" || ch.position === "sitting") {
      hpr += 3 + con; mpr += 3 + int; mvr += 3 + dex;
    }

    ch.hp = Math.min(ch.maxHp, ch.hp + Math.max(0, hpr));
    ch.mana = Math.min(ch.maxMana, ch.mana + Math.max(0, mpr));
    ch.move = Math.min(ch.maxMove, ch.move + Math.max(0, mvr));
    sendVitals(this.live.world, p);
  }
}
