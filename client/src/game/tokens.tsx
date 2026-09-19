/**
 * Room tokens — the creatures and the player as clickable discs. Each token owns its own combat
 * overlays: an animated health bar, floating damage/miss numbers, a hit flash, a death state, and
 * a status-effect strip. The effect strip is spell-ready: it renders whatever effect keys the
 * server puts on the entity (none in v1), so wiring buffs/debuffs later needs no layout change.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { RoomMob } from "../protocol";
import type { FxEvent } from "../store";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON, iconForMob } from "../art/iconMap";
import { AnimatedBar } from "./bars";

const TOKEN = 56;

/** Known status-effect keys -> icon; anything unknown shows a neutral violet mark. Empty in v1. */
const EFFECT_ICON: Record<string, IconName> = {};

/** A con-style threat color from the level gap: grey (trivial) → green → gold → red → violet (deadly). */
function threatColor(mobLevel: number, playerLevel: number): string {
  const d = mobLevel - playerLevel;
  if (d <= -6) return theme.dim;
  if (d < -2) return theme.accent;
  if (d <= 2) return theme.gold;
  if (d <= 6) return theme.danger;
  return theme.violet;
}

interface Floater {
  key: number;
  text: string;
  color: string;
}

let floaterSeq = 0;

/** Subscribe a token to the fx stream: returns live floaters + a flash value for hits landing on it. */
function useCombatFx(fx: FxEvent[], myId: string) {
  const seen = useRef(new Set<number>());
  const flash = useRef(new Animated.Value(0)).current;
  const [floaters, setFloaters] = useState<Floater[]>([]);

  useEffect(() => {
    for (const ev of fx) {
      if (seen.current.has(ev.id) || ev.fx.targetId !== myId) continue;
      seen.current.add(ev.id);
      const f = ev.fx;
      if (f.kind === "death") continue; // death is shown by the token's dead state
      const text = f.kind === "miss" ? "miss" : `${f.amount}${f.lucky ? "!" : ""}`;
      const color = f.kind === "miss" ? theme.dim : f.lucky ? theme.gold : theme.blood;
      const key = floaterSeq++;
      setFloaters((cur) => [...cur, { key, text, color }]);
      if (f.kind === "hit") {
        flash.setValue(1);
        Animated.timing(flash, { toValue: 0, duration: 320, useNativeDriver: true }).start();
      }
    }
    // keep the seen set bounded
    if (seen.current.size > 200) seen.current = new Set([...seen.current].slice(-100));
  }, [fx, myId, flash]);

  const remove = (key: number) => setFloaters((cur) => cur.filter((f) => f.key !== key));
  return { floaters, remove, flash };
}

function Floater({ text, color, onDone }: { text: string; color: string; onDone: () => void }) {
  const y = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: -38, duration: 900, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(op, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    ]).start(() => onDone());
  }, [y, op, onDone]);
  return (
    <Animated.Text style={[styles.floater, { color, opacity: op, transform: [{ translateY: y }] }]}>
      {text}
    </Animated.Text>
  );
}

function EffectStrip({ effects }: { effects?: string[] }) {
  if (!effects || effects.length === 0) return <View style={styles.effectStrip} />;
  return (
    <View style={styles.effectStrip}>
      {effects.slice(0, 4).map((e, i) =>
        EFFECT_ICON[e] ? (
          <SvgIcon key={i} name={EFFECT_ICON[e]!} size={12} color={theme.violet} />
        ) : (
          <View key={i} style={styles.effectDot} />
        ),
      )}
    </View>
  );
}

/** Shared token shell: floating numbers, hit flash, name/level, health bar, effect strip. */
function TokenBody({
  fx,
  id,
  icon,
  iconColor,
  ring,
  label,
  sub,
  subColor,
  badge,
  hpPct,
  hpColor,
  effects,
  dead,
}: {
  fx: FxEvent[];
  id: string;
  icon: IconName;
  iconColor: string;
  ring: string | null;
  label: string;
  sub: string;
  subColor?: string;
  badge?: IconName | null;
  hpPct: number;
  hpColor: string;
  effects?: string[];
  dead: boolean;
}) {
  const { floaters, remove, flash } = useCombatFx(fx, id);
  const scale = flash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const glow = flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] });
  return (
    <View style={styles.token}>
      <View style={styles.floaterAnchor} pointerEvents="none">
        {floaters.map((f) => (
          <Floater key={f.key} text={f.text} color={f.color} onDone={() => remove(f.key)} />
        ))}
      </View>
      <Animated.View
        style={[
          styles.disc,
          { transform: [{ scale }], opacity: dead ? 0.55 : 1 },
          ring ? { borderColor: ring, borderWidth: 2 } : null,
        ]}
      >
        <Animated.View style={[styles.hitGlow, { opacity: glow }]} pointerEvents="none" />
        <SvgIcon name={dead ? ICON.death : icon} size={34} color={dead ? theme.dim : iconColor} />
        {badge && !dead && (
          <View style={styles.badge}>
            <SvgIcon name={badge} size={12} color={theme.bg} />
          </View>
        )}
      </Animated.View>
      <Text style={styles.name} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.sub, subColor ? { color: subColor } : null]} numberOfLines={1}>
        {sub}
      </Text>
      <AnimatedBar pct={hpPct} color={hpColor} width={TOKEN} height={5} />
      <EffectStrip effects={effects} />
    </View>
  );
}

export function EnemyToken({
  mob,
  playerLevel,
  hpPct,
  engaged,
  fx,
  onEngage,
  dead,
}: {
  mob: RoomMob;
  playerLevel: number;
  hpPct: number;
  engaged: boolean;
  fx: FxEvent[];
  onEngage: (id: string) => void;
  dead: boolean;
}) {
  const icon = mob.shopkeeper ? "cowled" : iconForMob(mob.keywords, mob.name);
  const threat = threatColor(mob.level, playerLevel);
  // Shopkeepers read as friendly (gold), foes carry a threat ring; the engaged target overrides to blood.
  const ring = engaged ? theme.blood : mob.shopkeeper ? theme.gold : threat;
  return (
    <Pressable onPress={() => !dead && onEngage(mob.id)} disabled={dead} accessibilityRole="button">
      <TokenBody
        fx={fx}
        id={mob.id}
        icon={icon}
        iconColor={engaged ? theme.blood : theme.boneDim}
        ring={ring}
        badge={mob.shopkeeper ? ICON.gold : null}
        label={mob.name}
        sub={`L${mob.level}`}
        subColor={mob.shopkeeper ? theme.gold : threat}
        hpPct={hpPct}
        hpColor={theme.blood}
        effects={mob.effects}
        dead={dead}
      />
    </Pressable>
  );
}

export function PlayerToken({
  id,
  self,
  hpPct,
  fx,
  effects,
}: {
  id: string; // our character id, so fx targeting us lands on this token
  self: { name: string; level: number };
  hpPct: number;
  fx: FxEvent[];
  effects?: string[];
}) {
  return (
    <View>
      <TokenBody
        fx={fx}
        id={id}
        icon={ICON.player}
        iconColor={theme.accent}
        ring={theme.accentDim}
        label={self.name}
        sub={`L${self.level}`}
        hpPct={hpPct}
        hpColor={theme.accent}
        effects={effects}
        dead={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  token: { alignItems: "center", width: TOKEN + 24, paddingVertical: 4 },
  floaterAnchor: { position: "absolute", top: -6, left: 0, right: 0, alignItems: "center", zIndex: 5 },
  floater: { fontFamily: fonts.display, fontSize: 20, textShadowColor: "#000", textShadowRadius: 3 },
  disc: {
    width: TOKEN,
    height: TOKEN,
    borderRadius: TOKEN / 2,
    backgroundColor: theme.panelAlt,
    borderWidth: 1,
    borderColor: theme.panelBorder,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hitGlow: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: theme.blood },
  badge: {
    position: "absolute", top: -2, right: -2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: theme.gold, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.bg,
  },
  name: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 12, marginTop: 3, maxWidth: TOKEN + 22 },
  sub: { color: theme.dim, fontFamily: fonts.body, fontSize: 10, marginBottom: 3 },
  effectStrip: { flexDirection: "row", gap: 3, height: 14, marginTop: 3, alignItems: "center" },
  effectDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.violet },
});
