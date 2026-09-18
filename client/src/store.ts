/** Game UI state + reducer. Server messages are folded into this via applyMessage. */
import type { CharacterSummary, Line, RoomView, ServerMessage, Vitals } from "./protocol";
import { parseColorSpans } from "./protocol";

export type Phase = "connecting" | "characters" | "playing";

export interface OutputLine {
  id: number;
  line: Line;
}

export interface GameState {
  phase: Phase;
  characters: CharacterSummary[];
  output: OutputLine[];
  room: RoomView | null;
  vitals: Vitals | null;
  notice: string | null;
}

export const initialState: GameState = {
  phase: "connecting",
  characters: [],
  output: [],
  room: null,
  vitals: null,
  notice: null,
};

const MAX_OUTPUT = 500;
let outputSeq = 0;

function appendLines(state: GameState, lines: Line[]): OutputLine[] {
  const next = state.output.concat(lines.map((line) => ({ id: outputSeq++, line })));
  return next.length > MAX_OUTPUT ? next.slice(next.length - MAX_OUTPUT) : next;
}

export type Action = { type: "server"; msg: ServerMessage } | { type: "reset" };

export function reducer(state: GameState, action: Action): GameState {
  if (action.type === "reset") return { ...initialState };
  const m = action.msg;
  switch (m.t) {
    case "auth_ok":
      return { ...state, phase: "characters", notice: null };
    case "auth_error":
      return { ...state, notice: m.message };
    case "char_list":
      return { ...state, characters: m.characters, phase: "characters" };
    case "entered":
      return { ...state, phase: "playing", notice: null };
    case "output":
      return { ...state, output: appendLines(state, m.lines) };
    case "room":
      return { ...state, room: m.room };
    case "vitals":
      return { ...state, vitals: m.vitals };
    case "system":
      return { ...state, output: appendLines(state, [parseColorSpans("&Y" + m.text + "&D")]) };
    case "error":
      return { ...state, output: appendLines(state, [parseColorSpans("&R" + m.message + "&D")]) };
    default:
      return state;
  }
}
