/**
 * Per-connection session: the state machine a socket walks through —
 *   authenticating  ->  choosing a character  ->  playing in the world.
 *
 * The session is the bridge between a raw Connection and the game: it authenticates via
 * Supabase, creates/loads characters through the Db, and once in-game it is the Player the
 * LiveWorld tracks and broadcasts to.
 */
import { randomUUID } from "node:crypto";
import type { CharacterSummary, ClientMessage, ServerMessage } from "@hoggie/shared";
import { log } from "../log.ts";
import type { AppConfig } from "../config.ts";
import type { World } from "../world/world.ts";
import type { Authenticator } from "../auth/verify.ts";
import type { Db, Account } from "../db/repos.ts";
import type { Connection } from "../net/connection.ts";
import { LiveWorld, type Player } from "./liveWorld.ts";
import {
  V1_CLASSES,
  V1_RACES,
  className,
  createCharacter,
  raceName,
  type Character,
} from "./character.ts";
import { dispatchCommand } from "./commands.ts";
import { PlayerFighter } from "./fighter.ts";
import type { CombatManager } from "./combat.ts";
import { esc, out, sendRoom, sendVitals } from "./view.ts";

export interface GameServices {
  config: AppConfig;
  world: World;
  live: LiveWorld;
  auth: Authenticator;
  db: Db | null;
  combat: CombatManager;
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
      className: className(this.svc.world, ch),
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
          return this.doCreate(msg.name, msg.raceId, msg.classId);
        if (msg.t === "char_select") return this.doSelect(msg.characterId);
        return this.send({ t: "error", message: "choose a character first" });

      case "playing":
        if (msg.t === "cmd") return this.doCommand(msg.raw);
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
    await this.sendCharList();
  }

  private async sendCharList(): Promise<void> {
    if (!this.account || !this.svc.db) return;
    const chars = await this.svc.db.listCharacters(this.account.id);
    this.send({ t: "char_list", characters: chars.map((c) => this.summary(c)) });
  }

  private async doCreate(name: string, raceId: number, classId: number): Promise<void> {
    if (!this.account || !this.svc.db) return;
    if (!NAME_RE.test(name)) {
      return this.send({ t: "error", message: "name must be 2-20 letters, no spaces or symbols" });
    }
    const race = this.svc.world.races.get(raceId);
    const cls = this.svc.world.classes.get(classId);
    if (!race || !(V1_RACES as readonly string[]).includes(race.name)) {
      return this.send({ t: "error", message: `pick a race: ${V1_RACES.join(", ")}` });
    }
    if (!cls || !(V1_CLASSES as readonly string[]).includes(cls.name)) {
      return this.send({ t: "error", message: `pick a class: ${V1_CLASSES.join(", ")}` });
    }
    if (!race.allowedClasses.includes(cls.name)) {
      return this.send({ t: "error", message: `a ${race.name} cannot be a ${cls.name}` });
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
    this.player = { character, account: this.account ?? undefined, send: (m) => this.conn.send(m) };
    this.fighter = new PlayerFighter(character, this.svc.world, (m) => this.conn.send(m));
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
    log.info("character entered world", { name: character.name, room: character.roomVnum });
  }

  private doCommand(raw: string): void {
    if (!this.player || !this.fighter || !this.account) return;
    dispatchCommand(
      {
        world: this.svc.world,
        live: this.svc.live,
        player: this.player,
        combat: this.svc.combat,
        fighter: this.fighter,
        account: this.account,
        db: this.svc.db,
        quit: () => this.close(),
      },
      raw,
    );
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
