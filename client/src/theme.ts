import { Platform } from "react-native";

/**
 * Gothic art direction: near-black stone, bone ink, sickly green, blood red, a bruised violet
 * and tarnished gold. Keys the older text components used (bg/panel/text/…) are kept so nothing
 * breaks; the visual client adds the richer palette on top.
 */
export const theme = {
  // surfaces (deepest -> raised)
  bg: "#0b0d10",
  bgAlt: "#12151b",
  panel: "#171a21",
  panelAlt: "#1c202a",
  panelBorder: "#2a2f3a",
  shadow: "#05070a",

  // ink
  bone: "#e8e0d0",
  boneDim: "#d8cfc0",
  text: "#d8cfc0",
  dim: "#8a8577",

  // accents
  accent: "#7db34a", // sickly green — primary
  accentDim: "#4a5d23",
  blood: "#b22222",
  bloodDim: "#8b1e1e",
  violet: "#7c6bb0",
  gold: "#c9a227",

  // vitals / status
  danger: "#c8433a",
  input: "#12151b",
  hp: "#b22222",
  mana: "#5a7bb0",
  move: "#7db34a",
};

/** Bundled Google Fonts (OFL): Grenze Gotisch for display, Spectral for body. */
export const fonts = {
  display: "GrenzeGotisch_700Bold",
  displaySemi: "GrenzeGotisch_600SemiBold",
  body: "Spectral_400Regular",
  bodyMed: "Spectral_500Medium",
  bodySemi: "Spectral_600SemiBold",
};

export const mono = Platform.select({
  web: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  default: "monospace",
}) as string;
