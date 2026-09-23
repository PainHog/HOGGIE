/**
 * Sprite — draws a single 16×16 tile from the bundled Kenney Tiny Dungeon sheet, scaled up with
 * crisp (nearest-neighbour) edges. Implemented as an overflow-clipped window over the full sheet,
 * offset to the requested tile; works on web (image-rendering: pixelated) and native.
 */
import { Image, View, type ViewStyle } from "react-native";
import { SHEET_COLS, SHEET_H, SHEET_TILE, SHEET_W } from "./sprites";

// Static require so Metro bundles the asset.
const SHEET = require("../../assets/kenney/tiny-dungeon.png");

export function Sprite({
  index,
  size = 64,
  flip = false,
  style,
  opacity = 1,
}: {
  index: number;
  size?: number;
  flip?: boolean;
  style?: ViewStyle;
  opacity?: number;
}) {
  const scale = size / SHEET_TILE;
  const col = index % SHEET_COLS;
  const row = Math.floor(index / SHEET_COLS);
  return (
    <View
      style={[
        { width: size, height: size, overflow: "hidden", opacity },
        flip ? { transform: [{ scaleX: -1 }] } : null,
        style,
      ]}
      pointerEvents="none"
    >
      <Image
        source={SHEET}
        resizeMode="stretch"
        style={{
          width: SHEET_W * scale,
          height: SHEET_H * scale,
          transform: [{ translateX: -col * SHEET_TILE * scale }, { translateY: -row * SHEET_TILE * scale }],
          // web-only crisp (nearest-neighbour) scaling; native ignores the extra key
          imageRendering: "pixelated",
        } as object}
      />
    </View>
  );
}
