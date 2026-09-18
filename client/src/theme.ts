import { Platform } from "react-native";

export const theme = {
  bg: "#0f1115",
  panel: "#171a21",
  panelBorder: "#2a2f3a",
  text: "#c8ccd4",
  dim: "#7a808c",
  accent: "#69db7c",
  accentDim: "#2f4638",
  input: "#1e222b",
  danger: "#ff6b6b",
  gold: "#ffd43b",
  hp: "#e03131",
  mana: "#4dabf7",
  move: "#69db7c",
};

export const mono = Platform.select({
  web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  default: "monospace",
}) as string;
