/** Game UI state + reducer. Server messages are folded into this via applyMessage. */
import type {
  Catalog,
  CharacterSummary,
  CombatFx,
  InventoryItem,
  Line,
  RoomExit,
  RoomView,
  ServerMessage,
  SkillInfo,
  Vitals,
} from "./protocol";
import { parseColorSpans } from "./protocol";

export type Phase = "connecting" | "characters" | "playing";

export interface OutputLine {
  id: number;
  line: Line;
}

/** A room we've seen — accumulated so the minimap can draw the explored neighbourhood. */
export interface KnownRoom {
  vnum: number;
  name: string;
  sector: string;
  exits: RoomExit[];
}

/** A combat fx tagged with a client id so the scene animates each one exactly once. */
export interface FxEvent {
  id: number;
  fx: CombatFx;
}

export interface GameState {
  phase: Phase;
  characters: CharacterSummary[];
  catalog: Catalog | null; // selectable races/classes (data-driven creation)
  selfId: string | null; // our own character id (to tell our hits/wounds apart in fx)
  output: OutputLine[];
  room: RoomView | null;
  vitals: Vitals | null;
  inventory: InventoryItem[]; // what the character is carrying (inventory panel + shop)
  skills: SkillInfo[]; // the character's class skill/spell tree (skills panel)
  skillsLabel: string; // e.g. "Warrior" or "Warrior/Mage"
  notice: string | null;
  rooms: Record<number, KnownRoom>; // explored graph for the minimap
  mobHp: Record<string, number>; // mob instance id -> live hp fraction (0..1)
  engagedTargetId: string | null; // the mob we're currently fighting (drives combat UI)
  fx: FxEvent[]; // recent combat fx for the scene to animate
}

export const initialState: GameState = {
  phase: "connecting",
  characters: [],
  catalog: null,
  selfId: null,
  output: [],
  room: null,
  vitals: null,
  inventory: [],
  skills: [],
  skillsLabel: "",
  notice: null,
  rooms: {},
  mobHp: {},
  engagedTargetId: null,
  fx: [],
};

const MAX_OUTPUT = 500;
const MAX_FX = 40;
let outputSeq = 0;
let fxSeq = 0;

function appendLines(state: GameState, lines: Line[]): OutputLine[] {
  const next = state.output.concat(lines.map((line) => ({ id: outputSeq++, line })));
  return next.length > MAX_OUTPUT ? next.slice(next.length - MAX_OUTPUT) : next;
}

export type Action =
  | { type: "server"; msg: ServerMessage }
  | { type: "engage"; mobId: string } // optimistic: the moment the player clicks a foe
  | { type: "reset" };

export function reducer(state: GameState, action: Action): GameState {
  if (action.type === "reset") return { ...initialState };
  if (action.type === "engage") return { ...state, engagedTargetId: action.mobId };

  const m = action.msg;
  switch (m.t) {
    case "auth_ok":
      return { ...state, phase: "characters", notice: null };
    case "auth_error":
      return { ...state, notice: m.message };
    case "char_list":
      return { ...state, characters: m.characters, phase: "characters" };
    case "catalog":
      return { ...state, catalog: m.catalog };
    case "entered":
      return { ...state, phase: "playing", notice: null, selfId: m.character.id };
    case "output":
      return { ...state, output: appendLines(state, m.lines) };
    case "room":
      return applyRoom(state, m.room);
    case "vitals":
      return { ...state, vitals: m.vitals };
    case "inventory":
      return { ...state, inventory: m.items };
    case "skills":
      return { ...state, skills: m.skills, skillsLabel: m.label };
    case "fx":
      return applyFx(state, m.fx);
    case "system":
      return { ...state, output: appendLines(state, [parseColorSpans("&Y" + m.text + "&D")]) };
    case "error":
      return { ...state, output: appendLines(state, [parseColorSpans("&R" + m.message + "&D")]) };
    default:
      return state;
  }
}

/** A fresh room snapshot: reseed live mob HP, record the room for the minimap, drop a stale target. */
function applyRoom(state: GameState, room: RoomView): GameState {
  const mobHp: Record<string, number> = {};
  for (const mob of room.mobs) mobHp[mob.id] = mob.hpPct;
  const stillHere = room.mobs.some((mob) => mob.id === state.engagedTargetId);
  return {
    ...state,
    room,
    mobHp,
    engagedTargetId: stillHere ? state.engagedTargetId : null,
    rooms: {
      ...state.rooms,
      [room.vnum]: { vnum: room.vnum, name: room.name, sector: room.sector, exits: room.exits },
    },
  };
}

/** A combat event: track the target's live HP, follow the fight, and queue it for animation. */
function applyFx(state: GameState, fx: CombatFx): GameState {
  const mobHp = { ...state.mobHp };
  if (fx.kind !== "death" || fx.targetId in mobHp) mobHp[fx.targetId] = fx.targetHpPct;

  let engaged = state.engagedTargetId;
  // Our own strike defines who we're fighting; a target's death ends it.
  if (fx.sourceId === state.selfId && fx.kind !== "death") engaged = fx.targetId;
  if (fx.kind === "death" && fx.targetId === engaged) engaged = null;

  const queued = state.fx.concat({ id: fxSeq++, fx });
  return {
    ...state,
    mobHp,
    engagedTargetId: engaged,
    fx: queued.length > MAX_FX ? queued.slice(queued.length - MAX_FX) : queued,
  };
}
