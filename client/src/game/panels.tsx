/**
 * Side panels: a Character sheet (real stats from the server) and an Inventory list (real carried
 * items from the server). Equipment slots are still shells (worn gear is roadmap), but the inventory
 * now reflects what the character is actually holding, so shops (buy/sell) are visible in the UI.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { InventoryItem, Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";

/** Pick an icon for a carried item from its item_type (falls back to the knapsack glyph). */
function iconForItem(itemType: string): IconName {
  switch (itemType) {
    case "armor": return ICON.slotBody;
    case "weapon": return ICON.slotWeapon;
    case "potion": case "scroll": case "wand": case "staff": case "pill": case "salve":
      return "magic-swirl";
    case "treasure": case "money": return ICON.gold;
    default: return ICON.inventory;
  }
}

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
        Level {vitals.level}
        {vitals.tier ? ` · Tier ${vitals.tier} (eff ${50 + Math.floor(vitals.level / 10)})` : ""}{" "}
        {vitals.race} {vitals.className}
        {vitals.dualClassName ? ` / ${vitals.dualClassName}` : ""}
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

export function InventoryPanel({ items }: { items: InventoryItem[] }) {
  return (
    <View style={styles.panel}>
      <View style={styles.invHead}>
        <SvgIcon name={ICON.inventory} size={18} color={theme.gold} />
        <Text style={styles.title}>Inventory</Text>
        <Text style={styles.invCount}>{items.length}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={styles.note}>Empty — buy from a shopkeeper or loot a corpse.</Text>
      ) : (
        <ScrollView style={styles.invList} contentContainerStyle={{ gap: 4 }}>
          {items.map((it, i) => (
            <View key={`${it.vnum}-${i}`} style={styles.invRow}>
              <SvgIcon name={iconForItem(it.itemType)} size={18} color={theme.accent} />
              <Text style={styles.invName} numberOfLines={1}>{it.name}</Text>
              <View style={styles.invPrice}>
                <SvgIcon name={ICON.gold} size={12} color={theme.gold} />
                <Text style={styles.invCost}>{it.cost}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <Text style={styles.note}>Worn gear & item stats — roadmap.</Text>
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
  invCount: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 12, marginLeft: "auto" },
  invList: { maxHeight: 220, marginTop: 4 },
  invRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bgAlt,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 6, paddingHorizontal: 8,
  },
  invName: { color: theme.bone, fontFamily: fonts.body, fontSize: 12, flex: 1 },
  invPrice: { flexDirection: "row", alignItems: "center", gap: 3 },
  invCost: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 11 },
});
