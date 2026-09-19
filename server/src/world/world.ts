/**
 * The World: the single authoritative in-memory holder of all game state.
 *
 * Phase 1 = empty registries + shape. The loader (Phase 2) fills the prototype maps from
 * content JSON; live rooms, mob/object instances, and connected characters get layered on
 * in Phase 2/3. Everything the live game touches lives here in RAM — Postgres is durability,
 * not the live loop.
 */
import type {
  Area,
  ClassDef,
  MobPrototype,
  ObjPrototype,
  RaceDef,
  Reset,
  Room,
  ShopDef,
  SkillDef,
} from "./model.ts";

export interface WorldSummary {
  areas: number;
  rooms: number;
  mobPrototypes: number;
  objPrototypes: number;
  classes: number;
  races: number;
  skills: number;
}

export class World {
  readonly areas = new Map<string, Area>();
  readonly rooms = new Map<number, Room>();
  readonly mobPrototypes = new Map<number, MobPrototype>();
  readonly objPrototypes = new Map<number, ObjPrototype>();
  readonly classes = new Map<number, ClassDef>();
  readonly races = new Map<number, RaceDef>();
  /** Skills are keyed by lowercased name (their natural identifier in the content). */
  readonly skills = new Map<string, SkillDef>();
  /** Reset instructions for loaded areas (used to repopulate the world). */
  readonly resets: Reset[] = [];
  /** Shops keyed by keeper mob vnum (systems-spec §4.2). */
  readonly shops = new Map<number, ShopDef>();
  /** A keeper's stock: the object vnums given to it by resets (its sellable inventory). */
  readonly shopStock = new Map<number, number[]>();

  getClassByName(name: string): ClassDef | undefined {
    const lc = name.toLowerCase();
    for (const c of this.classes.values()) if (c.name.toLowerCase() === lc) return c;
    return undefined;
  }

  getRaceByName(name: string): RaceDef | undefined {
    const lc = name.toLowerCase();
    for (const r of this.races.values()) if (r.name.toLowerCase() === lc) return r;
    return undefined;
  }

  getRoom(vnum: number): Room | undefined {
    return this.rooms.get(vnum);
  }

  getMobPrototype(vnum: number): MobPrototype | undefined {
    return this.mobPrototypes.get(vnum);
  }

  getObjPrototype(vnum: number): ObjPrototype | undefined {
    return this.objPrototypes.get(vnum);
  }

  getSkill(name: string): SkillDef | undefined {
    return this.skills.get(name.toLowerCase());
  }

  summary(): WorldSummary {
    return {
      areas: this.areas.size,
      rooms: this.rooms.size,
      mobPrototypes: this.mobPrototypes.size,
      objPrototypes: this.objPrototypes.size,
      classes: this.classes.size,
      races: this.races.size,
      skills: this.skills.size,
    };
  }
}
