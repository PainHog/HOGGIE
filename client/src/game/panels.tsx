/**
 * Side panels: a Character sheet (real stats from the server) and an Inventory grid. Equipment and
 * inventory are intentionally empty shells in v1 — the UI is real, the content (worn gear, carried
 * items) is roadmap — so the slots read as "empty", not as missing UI.
 */
import { StyleSheet, Text, View } from "react-native";
import type { Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Slot({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.slot}>
      <SvgIcon name={icon} size={22} color={theme.panelBorder} />
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={styles.slotEmpty}>empty</Text>
    </View>
  );
}

export function CharacterPanel({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) return null;
  const s = vitals.stats;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{vitals.name}</Text>
      <Text style={styles.subtitle}>
        Level {vitals.level} {vitals.race} {vitals.className}
      </Text>

      <View style={styles.statGrid}>
        <Stat label="STR" value={s.str} />
        <Stat label="INT" value={s.int} />
        <Stat label="WIS" value={s.wis} />
        <Stat label="DEX" value={s.dex} />
        <Stat label="CON" value={s.con} />
        <Stat label="CHA" value={s.cha} />
        <Stat label="LCK" value={s.lck} />
        <Stat label="ALIGN" value={vitals.alignment} />
      </View>

      <Text style={styles.section}>Equipment</Text>
      <View style={styles.slotRow}>
        <Slot icon={ICON.slotHead} label="Head" />
        <Slot icon={ICON.slotBody} label="Body" />
        <Slot icon={ICON.slotWeapon} label="Weapon" />
      </View>
      <Text style={styles.note}>Worn gear & armor class — roadmap.</Text>
    </View>
  );
}

export function InventoryPanel() {
  return (
    <View style={styles.panel}>
      <View style={styles.invHead}>
        <SvgIcon name={ICON.inventory} size={18} color={theme.gold} />
        <Text style={styles.title}>Inventory</Text>
      </View>
      <View style={styles.invGrid}>
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={i} style={styles.invCell} />
        ))}
      </View>
      <Text style={styles.note}>Loot, carrying capacity & item stats — roadmap.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, padding: 12, gap: 6 },
  title: { color: theme.gold, fontFamily: fonts.display, fontSize: 18 },
  subtitle: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, marginBottom: 4 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stat: {
    width: 56, backgroundColor: theme.bgAlt, borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder,
    paddingVertical: 5, alignItems: "center",
  },
  statLabel: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 10 },
  statValue: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 15 },
  section: { color: theme.accent, fontFamily: fonts.displaySemi, fontSize: 13, marginTop: 8 },
  slotRow: { flexDirection: "row", gap: 8 },
  slot: {
    flex: 1, alignItems: "center", gap: 2, backgroundColor: theme.bgAlt, borderRadius: 6,
    borderWidth: 1, borderColor: theme.panelBorder, borderStyle: "dashed", paddingVertical: 10,
  },
  slotLabel: { color: theme.text, fontFamily: fonts.bodySemi, fontSize: 11 },
  slotEmpty: { color: theme.dim, fontFamily: fonts.body, fontSize: 9, fontStyle: "italic" },
  note: { color: theme.dim, fontFamily: fonts.body, fontSize: 10, fontStyle: "italic", marginTop: 4 },
  invHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  invGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  invCell: {
    width: 40, height: 40, borderRadius: 6, backgroundColor: theme.bgAlt,
    borderWidth: 1, borderColor: theme.panelBorder,
  },
});
