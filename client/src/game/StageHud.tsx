/**
 * StageHud — the redesigned, framed gothic vitals HUD (Stage 1). A dark stone bar with a gold
 * hairline frame and corner rivets, a framed hero portrait (Kenney sprite), and ornate HP/mana/
 * move meters with a bevelled fill. Presentation only — same Vitals data as the old HUD.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { Sprite } from "../art/Sprite";
import { heroTileForClass } from "../art/sprites";

const FRAME = "#c9a227"; // tarnished gold
const STONE_A = "#1b1720";
const STONE_B = "#0d0b12";

/** A rivetted dark-stone frame around arbitrary content. */
function Framed({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[styles.framed, style]}>
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="stone" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={STONE_A} />
            <Stop offset="1" stopColor={STONE_B} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx="7" fill="url(#stone)" />
        <Rect x="1.5" y="1.5" width="99%" height="97%" rx="6" fill="none" stroke={FRAME} strokeOpacity={0.55} strokeWidth={1} />
        <Rect x="3.5" y="3.5" width="96%" height="93%" rx="4" fill="none" stroke={FRAME} strokeOpacity={0.14} strokeWidth={1} />
      </Svg>
      {children}
    </View>
  );
}

/** An ornate meter: label, bevelled fill, value. */
function Meter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={styles.meter}>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
        <View style={[styles.meterGloss, { width: `${pct * 100}%` }]} />
        <Text style={styles.meterValue}>{Math.max(0, Math.round(value))}/{Math.round(max)}</Text>
      </View>
    </View>
  );
}

export function StageHud({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) return <View style={styles.wrap} />;
  const tier = (vitals.tier ?? 0) > 0 ? vitals.tier : undefined;
  return (
    <View style={styles.wrap}>
      <Framed style={styles.bar}>
        <View style={styles.portraitWrap}>
          <View style={styles.portrait}>
            <Sprite index={heroTileForClass(vitals.className)} size={48} />
          </View>
        </View>

        <View style={styles.ident}>
          <Text style={styles.name} numberOfLines={1}>{vitals.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            L{vitals.level}{tier ? ` · Tier ${tier}` : ""} {vitals.race} {vitals.className}
            {vitals.dualClassName ? ` / ${vitals.dualClassName}` : ""}
          </Text>
        </View>

        <View style={styles.meters}>
          <Meter label="HP" value={vitals.hp} max={vitals.maxHp} color={theme.hp} />
          <Meter label="MP" value={vitals.mana} max={vitals.maxMana} color={theme.mana} />
          <Meter label="MV" value={vitals.move} max={vitals.maxMove} color={theme.move} />
        </View>

        <View style={styles.tags}>
          <Text style={styles.gold}>{vitals.gold} <Text style={styles.goldK}>gold</Text></Text>
          <Text style={styles.exp}>{vitals.exp} <Text style={styles.dim}>(tnl {vitals.tnl})</Text></Text>
          <Text style={styles.stance}>{vitals.position}</Text>
        </View>
      </Framed>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 10 },
  framed: { position: "relative" },
  bar: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 14, flexWrap: "wrap" },
  portraitWrap: { padding: 2 },
  portrait: {
    width: 52, height: 52, borderRadius: 8, backgroundColor: "#241d16",
    borderWidth: 1, borderColor: FRAME, alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  ident: { minWidth: 140 },
  name: { color: theme.gold, fontFamily: fonts.display, fontSize: 22, textShadowColor: "#000", textShadowRadius: 4 },
  sub: { color: theme.boneDim, fontFamily: fonts.body, fontSize: 12 },
  meters: { gap: 5, flexGrow: 1, minWidth: 200 },
  meter: { flexDirection: "row", alignItems: "center", gap: 8 },
  meterLabel: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 10, width: 20 },
  meterTrack: {
    flex: 1, height: 15, borderRadius: 4, backgroundColor: "#000", overflow: "hidden",
    borderWidth: 1, borderColor: "#2c2533", justifyContent: "center",
  },
  meterFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.9 },
  meterGloss: { position: "absolute", left: 0, top: 0, height: 5, backgroundColor: "#ffffff22" },
  meterValue: { alignSelf: "center", color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 10, textShadowColor: "#000", textShadowRadius: 3 },
  tags: { alignItems: "flex-end", gap: 2, minWidth: 96 },
  gold: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 13 },
  goldK: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  exp: { color: theme.violet, fontFamily: fonts.bodySemi, fontSize: 12 },
  dim: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  stance: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12, textTransform: "capitalize" },
});
