/**
 * RoomStage — a fully rendered, atmospheric room scene (Stage 1 of the visual overhaul).
 * A tiled stone chamber (Kenney Tiny Dungeon, CC0) with a back wall, an arched door, braziers,
 * props, an idle-animated hero and a foe — layered under procedural gothic lighting (torch glow,
 * depth gradients, drifting fog, vignette and a cool colour grade). Presentation only; the scene
 * reads the same room/vitals snapshot the rest of the client uses. No movement yet.
 */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import type { RoomView, Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { Sprite } from "../art/Sprite";
import { TILE, creatureTileFor, heroTileForClass } from "../art/sprites";

const DT = 46; // display size of one 16px tile
const NX = 24; // tiles per row (wider than any arena; clipped by the stage)
const FLOOR_ROWS = 6;
const WALL_ROWS = 2;
const FLOOR_H = FLOOR_ROWS * DT; // height of the floor band from the bottom
const rowKey = (r: number) => `r${r}`;

/** One horizontal band of a single tile, repeated across and centered. */
function TileRow({ index, count = NX, dim = 0 }: { index: number; count?: number; dim?: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <Sprite key={i} index={index} size={DT} opacity={1 - dim} />
      ))}
    </View>
  );
}

/** A figure standing on the floor: an oval shadow + the (optionally idle-bobbing) sprite. */
function Figure({
  index,
  size,
  left,
  bottom,
  flip,
  bob,
  tint,
}: {
  index: number;
  size: number;
  left?: number;
  bottom: number;
  flip?: boolean;
  bob?: Animated.Value;
  tint?: string;
}) {
  return (
    <View style={[styles.figure, { bottom, left }]}>
      <Svg width={size} height={size * 0.34} style={{ marginBottom: -size * 0.14 }}>
        <Ellipse cx={size / 2} cy={size * 0.17} rx={size * 0.34} ry={size * 0.12} fill="#000" opacity={0.45} />
      </Svg>
      <Animated.View style={bob ? { transform: [{ translateY: bob }] } : undefined}>
        <Sprite index={index} size={size} flip={flip} />
        {tint ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" /> : null}
      </Animated.View>
    </View>
  );
}

export function RoomStage({ room, vitals }: { room: RoomView | null; vitals: Vitals | null }) {
  const bob = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    // idle breathing bob for the hero
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -4, duration: 900, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
    // torch flicker
    Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 0.95, duration: 140, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0.6, duration: 220, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0.82, duration: 180, useNativeDriver: true }),
      ]),
    ).start();
  }, [bob, flicker]);

  const heroTile = heroTileForClass(vitals?.className);
  const foe = (room?.mobs ?? []).find((m) => m.hpPct > 0) ?? room?.mobs?.[0];
  const foeTile = foe ? creatureTileFor(foe.keywords, foe.name) : null;

  return (
    <View style={styles.stage}>
      {/* --- tiled chamber: bottom-anchored wall + floor bands --- */}
      <View style={styles.tileField} pointerEvents="none">
        {Array.from({ length: WALL_ROWS }).map((_, r) => (
          <TileRow key={rowKey(r)} index={TILE.wallBrick} dim={r === 0 ? 0.25 : 0.1} />
        ))}
        {Array.from({ length: FLOOR_ROWS }).map((_, r) => (
          <TileRow key={`f${r}`} index={r % 2 === 0 ? TILE.floorStone : TILE.floorPlank} dim={0.32 - r * 0.05} />
        ))}
      </View>

      {/* --- floor depth + ceiling darkness gradients --- */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="ceil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#05060a" stopOpacity={1} />
            <Stop offset="0.28" stopColor="#05060a" stopOpacity={0.65} />
            <Stop offset="0.5" stopColor="#05060a" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="floorDepth" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.45" stopColor="#000000" stopOpacity={0.55} />
            <Stop offset="0.72" stopColor="#000000" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.35} />
          </LinearGradient>
          <RadialGradient id="vig" cx="0.5" cy="0.46" rx="0.72" ry="0.72">
            <Stop offset="0.55" stopColor="#000000" stopOpacity={0} />
            <Stop offset="1" stopColor="#03040780" stopOpacity={0.85} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ceil)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#floorDepth)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vig)" />
      </Svg>

      {/* --- back-wall features: arched door + flanking braziers with warm glow --- */}
      <View style={styles.featureLayer} pointerEvents="none">
        <View style={[styles.doorWrap, { bottom: FLOOR_H - 8 }]}>
          <Sprite index={TILE.doorClosed} size={DT * 2.6} />
        </View>

        <TorchGlow left="18%" bottom={FLOOR_H + 6} flicker={flicker} />
        <TorchGlow left="78%" bottom={FLOOR_H + 6} flicker={flicker} />
        <View style={[styles.brazier, { left: "14%", bottom: FLOOR_H - 2 }]}>
          <Sprite index={TILE.brazier} size={DT * 1.3} />
        </View>
        <View style={[styles.brazier, { left: "80%", bottom: FLOOR_H - 2 }]}>
          <Sprite index={TILE.brazier} size={DT * 1.3} />
        </View>
      </View>

      {/* --- floor actors + props --- */}
      <View style={styles.featureLayer} pointerEvents="none">
        <Figure index={TILE.barrel} size={DT * 1.15} left={22} bottom={FLOOR_H * 0.32} />
        <Figure index={TILE.chest} size={DT * 1.15} bottom={FLOOR_H * 0.3} left={undefined} flip />
        {foeTile != null && (
          <View style={styles.foeSlot}>
            <Figure index={foeTile} size={DT * 1.8} bottom={FLOOR_H * 0.22} flip tint="#3a0d0d22" />
          </View>
        )}
        <View style={styles.heroSlot}>
          <Figure index={heroTile} size={DT * 2.3} bottom={FLOOR_H * 0.18} bob={bob} />
        </View>
      </View>

      {/* --- drifting fog + cool gothic colour grade --- */}
      <View style={[StyleSheet.absoluteFill, styles.fog]} pointerEvents="none" />
      <View style={[StyleSheet.absoluteFill, styles.grade]} pointerEvents="none" />

      {/* --- header --- */}
      <View style={styles.header} pointerEvents="none">
        <Text style={styles.roomName} numberOfLines={1}>{room?.name ?? "The Void"}</Text>
        <Text style={styles.sector}>{room?.sector ?? ""}</Text>
      </View>
    </View>
  );
}

/** A warm radial pool of torch light, gently flickering. */
function TorchGlow({ left, bottom, flicker }: { left: `${number}%`; bottom: number; flicker: Animated.Value }) {
  return (
    <Animated.View style={[styles.glow, { left, bottom, opacity: flicker }]}>
      <Svg width={220} height={220}>
        <Defs>
          <RadialGradient id="tg" cx="0.5" cy="0.5" rx="0.5" ry="0.5">
            <Stop offset="0" stopColor="#ffb257" stopOpacity={0.55} />
            <Stop offset="0.45" stopColor="#e07a2a" stopOpacity={0.18} />
            <Stop offset="1" stopColor="#e07a2a" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={110} cy={110} rx={110} ry={110} fill="url(#tg)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    minHeight: 340,
    backgroundColor: "#070609",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#241d2b",
    overflow: "hidden",
  },
  tileField: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  row: { flexDirection: "row", height: DT },
  featureLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center" },
  doorWrap: { position: "absolute", alignItems: "center" },
  brazier: { position: "absolute" },
  glow: { position: "absolute", marginLeft: -110 },
  figure: { position: "absolute", alignItems: "center" },
  heroSlot: { position: "absolute", left: "50%", marginLeft: -DT * 1.15, bottom: 0, top: 0 },
  foeSlot: { position: "absolute", left: "63%", bottom: 0, top: 0 },
  fog: {
    backgroundColor: "transparent",
    // a faint low band of mist near the floor
    borderBottomWidth: 90,
    borderBottomColor: "#6a5b7a14",
  },
  grade: { backgroundColor: "#0b1a2210" },
  header: { position: "absolute", top: 10, left: 14, right: 14, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  roomName: { color: theme.gold, fontFamily: fonts.display, fontSize: 21, flexShrink: 1, textShadowColor: "#000", textShadowRadius: 6 },
  sector: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, textTransform: "lowercase", textShadowColor: "#000", textShadowRadius: 4 },
});
