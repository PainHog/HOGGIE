/** Vitals HUD — the player's name/class, three fixed-size stat bars, and a gold/exp/stance line. */
import { StyleSheet, Text, View } from "react-native";
import type { Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { SvgIcon } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";
import { StatBar } from "./bars";

export function VitalsHud({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) return <View style={styles.hud} />;
  return (
    <View style={styles.hud}>
      <View style={styles.left}>
        <Text style={styles.name} numberOfLines={1}>{vitals.name}</Text>
        <Text style={styles.meta}>
          L{vitals.level} {vitals.race} {vitals.className}
        </Text>
      </View>
      <View style={styles.bars}>
        <StatBar icon={ICON.hp} value={vitals.hp} max={vitals.maxHp} color={theme.hp} />
        <StatBar icon={ICON.mana} value={vitals.mana} max={vitals.maxMana} color={theme.mana} />
        <StatBar icon={ICON.move} value={vitals.move} max={vitals.maxMove} color={theme.move} />
      </View>
      <View style={styles.tags}>
        <View style={styles.tag}>
          <SvgIcon name={ICON.gold} size={14} color={theme.gold} />
          <Text style={[styles.tagText, { color: theme.gold }]}>{vitals.gold}</Text>
        </View>
        <View style={styles.tag}>
          <SvgIcon name={ICON.exp} size={14} color={theme.violet} />
          <Text style={styles.tagText}>{vitals.exp} <Text style={styles.dim}>(tnl {vitals.tnl})</Text></Text>
        </View>
        <Text style={styles.stance}>{vitals.position}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16,
    backgroundColor: theme.panel, borderBottomWidth: 1, borderBottomColor: theme.panelBorder,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  left: { minWidth: 120 },
  name: { color: theme.gold, fontFamily: fonts.display, fontSize: 20 },
  meta: { color: theme.dim, fontFamily: fonts.body, fontSize: 12 },
  bars: { gap: 4 },
  tags: { gap: 4 },
  tag: { flexDirection: "row", alignItems: "center", gap: 5 },
  tagText: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 12 },
  dim: { color: theme.dim, fontFamily: fonts.body },
  stance: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12, textTransform: "capitalize" },
});
