/**
 * Per-connection session: the state machine a socket walks through —
 *   authenticating  ->  choosing a character  ->  playing in the world.
 *
 * The session is the bridge between a raw Connection and the game: it authenticates via
 * Supabase, creates/loads characters through the Db, and once in-game it is the Player the
 * LiveWorld tracks and broadcasts to.
 */
import { randomUUID } from "node:crypto";
import type { Catalog, CharacterSummary, ClassInfo, ClientMessage, RaceInfo, ServerMessage } from "@hoggie/shared";
import { log } from "../log.ts";
import type { AppConfig } from "../config.ts";
import type { World } from "../world/world.ts";
import type { Authenticator } from "../auth/verify.ts";
import type { Db, Account } from "../db/repos.ts";
import type { Connection } from "../net/connection.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import {
  className,
  createCharacter,
  dualClassName,
  raceAllowsClass,
  raceName,
  type Character,
} from "./character.ts";
import { dispatchCommand, engageMobById, type CommandContext } from "./commands.ts";
import { PlayerFighter } from "./fighter.ts";
import type { CombatManager } from "./combat.ts";
import type { Economy } from "./economy.ts";
import { esc, out, sendEquipment, sendInventory, sendRoom, sendSkills, sendVitals } from "./view.ts";

export interface GameServices {
  config: AppConfig;
  world: World;
  live: LiveWorld;
  auth: Authenticator;
  db: Db | null;
  combat: CombatManager;
  economy: Economy;
}

type State = "authenticating" | "choosing" | "playing";

const NAME_RE = /^[A-Za-z]{2,20}$/;

export class Session {
  private state: State = "authenticating";
  private account: Account | null = null;
  private character: Character | null = null;
  private player: Player | null = null;
  private fighter: PlayerFighter | null = null;

  constructor(
    private readonly conn: Connection,
    private readonly svc: GameServices,
  ) {}

  private send(msg: ServerMessage): void {
    this.conn.send(msg);
  }

  private summary(ch: Character): CharacterSummary {
    return {
      id: ch.id,
      name: ch.name,
      race: raceName(this.svc.world, ch),
      className: className(this.svc.world, ch) + (dualClassName(this.svc.world, ch) ? `/${dualClassName(this.svc.world, ch)}` : ""),
      level: ch.level,
    };
  }

  async handle(msg: ClientMessage): Promise<void> {
    // Connection-level messages work in any state.
    if (msg.t === "ping") return this.send({ t: "pong" });
    if (msg.t === "echo") return this.send({ t: "echo", text: msg.text });

    switch (this.state) {
      case "authenticating":
        if (msg.t === "auth") return this.doAuth(msg.token);
        return this.send({ t: "error", message: "authenticate first (send { t: 'auth', token })" });

      case "choosing":
        if (msg.t === "char_list") return this.sendCharList();
        if (msg.t === "char_create")
          return this.doCreate(msg.name, msg.raceId, msg.classId, msg.secondClassId);
        if (msg.t === "char_select") return this.doSelect(msg.characterId);
        return this.send({ t: "error", message: "choose a character first" });

      case "playing":
        if (msg.t === "cmd") return this.doCommand(msg.raw);
        if (msg.t === "target") return this.doTarget(msg.mobId);
        return this.send({ t: "error", message: "already in the world" });
    }
  }

  private async doAuth(token: string): Promise<void> {
    if (!this.svc.db || !this.svc.auth.available) {
      return this.send({ t: "auth_error", message: "accounts are not configured on this server" });
    }
    let user;
    try {
      user = await this.svc.auth.verify(token);
    } catch (err) {
      log.warn("auth verify failed", { err: String(err) });
      return this.send({ t: "auth_error", message: "could not verify token" });
    }
    if (!user) return this.send({ t: "auth_error", message: "invalid or expired token" });

    try {
      this.account = await this.svc.db.ensureAccount(user.userId, user.email);
    } catch (err) {
      log.error("ensureAccount failed", { err: String(err) });
      return this.send({ t: "auth_error", message: "account lookup failed" });
    }
    if (this.account.banned) {
      return this.send({ t: "auth_error", message: "this account is banned" });
    }

    // Bootstrap the owner: configured admin emails are granted the admin role on login.
    const email = this.account.email?.toLowerCase();
    if (email && this.svc.config.adminEmails.includes(email) && !this.account.roles.includes("admin")) {
      this.account.roles = [...this.account.roles, "admin"];
      try {
        await this.svc.db.setAccountRoles(this.account.id, this.account.roles);
        log.info("granted admin (bootstrap)", { email });
      } catch (err) {
        log.warn("admin bootstrap failed", { err: String(err) });
      }
    }

    this.state = "choosing";
    this.send({ t: "auth_ok", accountId: this.account.id, email: this.account.email });
    this.sendCatalog();
    await this.sendCharList();
  }

  /** Send the data-driven creation catalog: every selectable race + the currently-open classes. */
  private sendCatalog(): void {
    const races: RaceInfo[] = [...this.svc.world.races.values()]
      .sort((a, b) => a.id - b.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        statPlus: r.statPlus,
        resistant: r.resistant,
        susceptible: r.susceptible,
        expMultPct: r.expMultPct,
        align: r.align,
        allowedClasses: r.allowedClasses,
        restrictedClasses: r.restrictedClasses,
        description: r.description,
      }));
    const classes: ClassInfo[] = [...this.svc.world.classes.values()]
      .filter((c) => !c.tiered) // tier classes are reached via advancetier, not creation
      .sort((a, b) => a.id - b.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        attrPrime: c.attrPrime,
        learnableCount: c.skills.length,
      }));
    const catalog: Catalog = { races, classes };
    this.send({ t: "catalog", catalog });
  }

  private async sendCharList(): Promise<void> {
    if (!this.account || !this.svc.db) return;
    const chars = await this.svc.db.listCharacters(this.account.id);
    this.send({ t: "char_list", characters: chars.map((c) => this.summary(c)) });
  }

  private async doCreate(name: string, raceId: number, classId: number, secondClassId?: number): Promise<void> {
    if (!this.account || !this.svc.db) return;
    if (!NAME_RE.test(name)) {
      return this.send({ t: "error", message: "name must be 2-20 letters, no spaces or symbols" });
    }
    const race = this.svc.world.races.get(raceId);
    const cls = this.svc.world.classes.get(classId);
    if (!race) {
      return this.send({ t: "error", message: "pick a valid race" });
    }
    if (!cls) {
      return this.send({ t: "error", message: "pick a valid class" });
    }
    if (cls.tiered) {
      return this.send({ t: "error", message: `${cls.name} is a tier class — reach it with advancetier, not at creation` });
    }
    if (!raceAllowsClass(race, cls.name)) {
      return this.send({ t: "error", message: `a ${race.name} cannot be a ${cls.name}` });
    }
    // Dual-class: a chosen second class must be a valid, race-allowed base class (prereqs enforced).
    if (secondClassId != null && secondClassId !== classId) {
      const second = this.svc.world.classes.get(secondClassId);
      if (!second) {
        return this.send({ t: "error", message: "pick a valid second class" });
      }
      if (second.tiered) {
        return this.send({ t: "error", message: `${second.name} is a tier class — not a dual-class option` });
      }
      if (!raceAllowsClass(race, second.name)) {
        return this.send({ t: "error", message: `a ${race.name} cannot be a ${second.name}` });
      }
    }
    if (await this.svc.db.isNameTaken(name)) {
      return this.send({ t: "error", message: `the name ${name} is already taken` });
    }

    const character = createCharacter(this.svc.world, {
      id: randomUUID(),
      accountId: this.account.id,
      name,
      raceId,
      classId,
      secondClassId,
      startRoom: this.svc.config.startRoom,
    });
    try {
      await this.svc.db.createCharacter(character);
    } catch (err) {
      log.error("createCharacter failed", { err: String(err) });
      return this.send({ t: "error", message: "could not create character (name may be taken)" });
    }
    this.enterWorld(character);
  }

  private async doSelect(characterId: string): Promise<void> {
    if (!this.account || !this.svc.db) return;
    const character = await this.svc.db.getCharacter(characterId, this.account.id);
    if (!character) return this.send({ t: "error", message: "no such character" });
    if (this.svc.live.isOnline(character.name)) {
      return this.send({ t: "error", message: `${character.name} is already in the world` });
    }
    this.enterWorld(character);
  }

  private enterWorld(character: Character): void {
    // If the saved room isn't in the loaded slice, fall back to the start room.
    if (!this.svc.world.getRoom(character.roomVnum)) {
      character.roomVnum = this.svc.config.startRoom;
    }
    this.character = character;
    this.fighter = new PlayerFighter(character, this.svc.world, (m) => this.conn.send(m));
    this.player = { character, account: this.account ?? undefined, fighter: this.fighter, send: (m) => this.conn.send(m) };
    this.state = "playing";

    this.svc.live.enter(this.player);
    this.send({ t: "entered", character: this.summary(character) });
    // Announce arrival to others already in the room.
    this.svc.live.broadcast(
      character.roomVnum,
      { t: "output", lines: [[{ text: `${esc(character.name)} appears in a swirl of ether.`, color: "gray" }]] },
      this.player,
    );
    out(this.player, `&YWelcome to House of Ghouls, ${esc(character.name)}.&D`);
    sendRoom(this.svc.live, this.player);
    sendVitals(this.svc.world, this.player);
    sendInventory(this.svc.world, this.player);
    sendEquipment(this.svc.world, this.player);
    sendSkills(this.svc.world, this.player);
    log.info("character entered world", { name: character.name, room: character.roomVnum });
  }

  /** Build the command context shared by text commands and the visual click handlers. */
  private ctx(): CommandContext | null {
    if (!this.player || !this.fighter || !this.account) return null;
    return {
      world: this.svc.world,
      live: this.svc.live,
      player: this.player,
      combat: this.svc.combat,
      economy: this.svc.economy,
      fighter: this.fighter,
      account: this.account,
      config: this.svc.config,
      db: this.svc.db,
      quit: () => this.close(),
    };
  }

  private doCommand(raw: string): void {
    const ctx = this.ctx();
    if (ctx) dispatchCommand(ctx, raw);
  }

  /** Visual click-to-engage: engage the mob with this instance id in the current room. */
  private doTarget(mobId: string): void {
    const ctx = this.ctx();
    if (ctx) engageMobById(ctx, mobId);
  }

  /** Called on socket close or `quit`. Persists and removes the player from the world. */
  async onClose(): Promise<void> {
    if (this.state === "playing" && this.player && this.character) {
      if (this.fighter) this.svc.combat.disengage(this.fighter);
      this.svc.live.broadcast(
        this.character.roomVnum,
        { t: "output", lines: [[{ text: `${esc(this.character.name)} fades away.`, color: "gray" }]] },
        this.player,
      );
      this.svc.live.leave(this.player);
      if (this.svc.db) {
        try {
          await this.svc.db.saveCharacter(this.character);
        } catch (err) {
          log.warn("save on disconnect failed", { err: String(err) });
        }
      }
    }
    this.state = "authenticating";
    this.player = null;
    this.fighter = null;
  }

  private close(): void {
    this.conn.ws.close();
  }
}
