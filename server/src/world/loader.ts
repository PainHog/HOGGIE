/**
 * Content loader — fills the in-memory World from the Step 1A JSON
 * (houseofghouls-export/content). Data-driven: widen the world by adding area names to
 * WORLD_AREAS, not by touching code. Snake_case JSON is mapped to the camelCase domain model.
 *
 * Classes / races / skills are global (all loaded). Rooms / mobs / objects / resets are
 * filtered to the configured area files (the v1 slice).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../log.ts";
import { World } from "./world.ts";
import type {
  ClassDef,
  MobPrototype,
  ObjPrototype,
  RaceDef,
  Reset,
  Room,
  SkillDef,
} from "./model.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

async function readJson(dir: string, file: string): Promise<Json> {
  return JSON.parse(await readFile(join(dir, file), "utf8"));
}

function mapRoom(r: Json): Room {
  return {
    vnum: r.vnum,
    area: r.area,
    name: r.name ?? "",
    description: r.description ?? "",
    sector: r.sector ?? "inside",
    roomFlags: r.room_flags ?? [],
    exits: (r.exits ?? []).map((e: Json) => ({
      dir: e.dir,
      toVnum: e.to_vnum,
      keyVnum: e.key_vnum,
      flags: e.flags,
      keyword: e.keyword,
    })),
    extraDescKeywords: r.extra_desc_keywords,
    teleport: r.teleport ? { delay: r.teleport.delay, toVnum: r.teleport.to_vnum } : undefined,
    tunnel: r.tunnel,
    hasRoomprogs: r.has_roomprogs,
  };
}

function mapMob(m: Json): MobPrototype {
  return {
    vnum: m.vnum,
    area: m.area,
    keywords: m.keywords ?? "",
    shortDesc: m.short_desc ?? "",
    longDesc: m.long_desc ?? "",
    description: m.description ?? "",
    level: m.level ?? 1,
    alignment: m.alignment ?? 0,
    actFlags: m.act_flags ?? [],
    affectFlags: m.affect_flags ?? [],
    thac0: m.thac0 ?? 0,
    ac: m.ac ?? 0,
    hpDice: m.hp_dice ?? "0d0+0",
    damDice: m.dam_dice ?? "0d0+0",
    gold: m.gold ?? 0,
    exp: m.exp ?? 0,
    position: m.position ?? "standing",
    defaultPosition: m.default_position ?? "standing",
    sex: m.sex ?? "neutral",
    stats: m.stats,
    saves: m.saves
      ? {
          saveDamage: m.saves.save_damage ?? 0,
          saveWand: m.saves.save_wand ?? 0,
          saveParaPetri: m.saves.save_para_petri ?? 0,
          saveBreath: m.saves.save_breath ?? 0,
          saveSpellStaff: m.saves.save_spell_staff ?? 0,
        }
      : undefined,
    raceId: m.race_id,
    classId: m.class_id,
    height: m.height,
    weight: m.weight,
    numAttacks: m.numattacks,
    hitroll: m.hitroll,
    damroll: m.damroll,
    resistant: m.resistant ?? [],
    immune: m.immune ?? [],
    susceptible: m.susceptible ?? [],
    specialAttacks: m.special_attacks ?? [],
    specialDefenses: m.special_defenses ?? [],
    simpleMob: m.simple_mob,
    hasMobprogs: m.has_mobprogs,
  };
}

function mapObj(o: Json): ObjPrototype {
  return {
    vnum: o.vnum,
    area: o.area,
    keywords: o.keywords ?? "",
    shortDesc: o.short_desc ?? "",
    description: o.description ?? "",
    actionDesc: o.action_desc ?? "",
    itemType: o.item_type ?? "trash",
    extraFlags: o.extra_flags ?? [],
    wearFlags: o.wear_flags ?? [],
    values: o.values ?? [],
    weight: o.weight ?? 0,
    cost: o.cost ?? 0,
    spells: o.spells,
    affects: (o.affects ?? []).map((a: Json) => ({ apply: a.apply, modifier: a.modifier })),
    extraDescKeywords: o.extra_desc_keywords,
    hasObjprogs: o.has_objprogs,
  };
}

function mapClass(c: Json): ClassDef {
  return {
    id: c.id,
    name: c.name,
    attrPrime: c.attr_prime,
    attrSecond: c.attr_second,
    attrTertiary: c.attr_tertiary,
    thac0Base: c.thac0_base ?? 0,
    thac0Mod: c.thac0_mod ?? 0,
    hpGainMin: c.hp_gain_min ?? 1,
    hpGainMax: c.hp_gain_max ?? 1,
    manaGain: c.mana_gain ?? 0,
    expBasePerLevel: c.exp_base_per_level ?? 100,
    skillAdeptCap: c.skill_adept_cap ?? 95,
    skills: (c.skills ?? []).map((s: Json) => ({
      skill: s.skill,
      level: s.level,
      adept: s.adept,
    })),
    titles: (c.titles ?? []).map((t: Json) => ({
      level: t.level,
      male: t.male,
      female: t.female,
    })),
  };
}

function mapRace(r: Json): RaceDef {
  return {
    id: r.id,
    name: r.name,
    statPlus: {
      str: r.str_plus ?? 0,
      int: r.int_plus ?? 0,
      wis: r.wis_plus ?? 0,
      dex: r.dex_plus ?? 0,
      con: r.con_plus ?? 0,
      cha: r.cha_plus ?? 0,
      lck: r.lck_plus ?? 0,
    },
    hitPlus: r.hit_plus,
    manaPlus: r.mana_plus,
    acPlus: r.ac_plus,
    expMultPct: r.exp_mult_pct ?? 100,
    align: r.align ?? 0,
    minAlign: r.min_align ?? -1000,
    maxAlign: r.max_align ?? 1000,
    resistBits: r.resist_bits,
    immuneBits: r.immune_bits,
    susceptBits: r.suscept_bits,
    allowedClasses: r.allowed_classes ?? [],
    restrictedClasses: r.restricted_classes ?? [],
  };
}

function mapSkill(s: Json): SkillDef {
  return {
    name: s.name,
    type: s.type,
    slot: s.slot,
    mana: s.mana,
    beats: s.beats,
    minLevel: s.min_level,
    minPosition: s.min_position,
    target: s.target,
    damageNoun: s.damage_noun,
    flags: s.flags,
    handlerKey: s.code_fn,
  };
}

function mapReset(r: Json): Reset {
  return {
    area: r.area,
    kind: r.kind,
    mobVnum: r.mob_vnum,
    objVnum: r.obj_vnum,
    roomVnum: r.room_vnum,
    containerVnum: r.container_vnum,
    wearLoc: r.wear_loc,
    maxInWorld: r.max_in_world,
    door: r.door,
    state: r.state,
  };
}

/** Load content into a fresh World. `areas` selects which area files' rooms/mobs/objects load. */
export async function loadWorld(contentDir: string, areas: string[]): Promise<World> {
  const world = new World();
  const areaSet = new Set(areas);

  const [
    areasJson,
    roomsJson,
    mobsJson,
    objsJson,
    resetsJson,
    classesJson,
    racesJson,
    skillsJson,
  ] = await Promise.all([
    readJson(contentDir, "areas.json"),
    readJson(contentDir, "rooms.json"),
    readJson(contentDir, "mobs.json"),
    readJson(contentDir, "objects.json"),
    readJson(contentDir, "resets.json"),
    readJson(contentDir, "classes.json"),
    readJson(contentDir, "races.json"),
    readJson(contentDir, "skills.json"),
  ]);

  // Global definitions.
  for (const c of classesJson) {
    const def = mapClass(c);
    world.classes.set(def.id, def);
  }
  for (const r of racesJson) {
    const def = mapRace(r);
    world.races.set(def.id, def);
  }
  for (const s of skillsJson) {
    const def = mapSkill(s);
    if (def.name) world.skills.set(def.name.toLowerCase(), def);
  }

  // Area metadata (all areas, cheap; only slice rooms load below).
  for (const a of areasJson) {
    if (!areaSet.has(a.file)) continue;
    world.areas.set(a.file, {
      file: a.file,
      name: a.name,
      author: a.author,
      version: a.version ?? 0,
      levelRange: a.level_range
        ? {
            softLow: a.level_range.soft_low,
            softHigh: a.level_range.soft_high,
            hardLow: a.level_range.hard_low,
            hardHigh: a.level_range.hard_high,
          }
        : undefined,
      areaFlags: a.area_flags,
      resetMsg: a.reset_msg,
      vnumRange: a.vnum_range,
    });
  }

  // Slice content.
  for (const r of roomsJson) {
    if (!areaSet.has(r.area)) continue;
    world.rooms.set(r.vnum, mapRoom(r));
  }
  for (const m of mobsJson) {
    if (!areaSet.has(m.area)) continue;
    world.mobPrototypes.set(m.vnum, mapMob(m));
  }
  for (const o of objsJson) {
    if (!areaSet.has(o.area)) continue;
    world.objPrototypes.set(o.vnum, mapObj(o));
  }
  for (const rs of resetsJson) {
    if (!areaSet.has(rs.area)) continue;
    world.resets.push(mapReset(rs));
  }

  log.info("world loaded from content", {
    loadedAreas: [...areaSet],
    ...world.summary(),
    resets: world.resets.length,
  });
  return world;
}
