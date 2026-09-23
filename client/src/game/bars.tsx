/** Fixed-size, animated stat bars — the fill tweens on change; the track never stretches. */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** A bare animated fill within a fixed-width track. */
export function AnimatedBar({
  pct,
  color,
  width,
  height = 8,
  track = theme.shadow,
}: {
  pct: number;
  color: string;
  width: number;
  height?: number;
  track?: string;
}) {
  const anim = useRef(new Animated.Value(clamp(pct))).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: clamp(pct), duration: 280, useNativeDriver: false }).start();
  }, [pct, anim]);
  const w = anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  return (
    <View style={[styles.track, { width, height, backgroundColor: track, borderRadius: height / 2 }]}>
      <Animated.View style={{ width: w, height: "100%", backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/** A HUD stat row: icon + fixed bar + value text (HP/MP/MV). */
export function StatBar({
  icon,
  value,
  max,
  color,
  width = 150,
}: {
  icon: IconName;
  value: number;
  max: number;
  color: string;
  width?: number;
}) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={styles.row}>
      <SvgIcon name={icon} size={16} color={color} />
      <View>
        <AnimatedBar pct={pct} color={color} width={width} height={10} />
        <Text style={styles.value}>
          {Math.max(0, Math.round(value))}/{Math.max(0, Math.round(max))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: "hidden", borderWidth: 1, borderColor: "#00000055" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  value: {
    position: "absolute",
    width: "100%",
    textAlign: "center",
    top: -1,
    color: theme.bone,
    fontFamily: fonts.bodySemi,
    fontSize: 9,
  },
});
