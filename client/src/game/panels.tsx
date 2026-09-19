/**
 * Side panels: a Character sheet (real stats from the server) and an Inventory list (real carried
 * items from the server). Equipment slots are still shells (worn gear is roadmap), but the inventory
 * now reflects what the character is actually holding, so shops (buy/sell) are visible in the UI.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Catalog, InventoryItem, SkillInfo, Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";
import { InfoTip } from "../ui/InfoTip";
import { STAT_INFO } from "../data/statInfo";

/** Pick an icon for a carried item from its item_type (falls back to the knapsack glyph). */
function iconForItem(itemType: string): IconName {
  switch (itemType) {
    case "armor": return ICON.slotBody;
    case "weapon": return ICON.slotWeapon;
    case "potion": case "pill": case "salve": return "round-potion";
    case "scroll": return "scroll-unfurled";
    case "wand": return "crystal-wand";
    case "staff": return "wizard-staff";
    case "food": case "drink": return "meat";
    case "key": return "key";
    case "light": return "torch";
    case "container": return "locked-chest";
    case "treasure": return "ring";
    case "money": return ICON.gold;
    default: return ICON.inventory;
  }
}

function Stat({ statKey, label, value }: { statKey: string; label: string; value: number | string }) {
  const info = STAT_INFO[statKey];
  return (
    <InfoTip title={info?.name ?? label} body={info?.body ?? ""} width={220}>
      <View style={styles.stat}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </InfoTip>
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

export function CharacterPanel({ vitals, catalog }: { vitals: Vitals | null; catalog?: Catalog | null }) {
  if (!vitals) return null;
  const s = vitals.stats;
  const raceLore = catalog?.races.find((r) => r.name === vitals.race)?.description ?? "";
  const classLore = catalog?.classes.find((c) => c.name === vitals.className)?.description ?? "";
  const lore = [raceLore, classLore].filter((t) => t.trim().length > 0).join("\n\n");
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{vitals.name}</Text>
      <InfoTip title={`${vitals.race} ${vitals.className}`} body={lore} width={260}>
        <Text style={styles.subtitle}>
          Level {vitals.level}
          {vitals.tier ? ` · Tier ${vitals.tier} (eff ${50 + Math.floor(vitals.level / 10)})` : ""}{" "}
          {vitals.race} {vitals.className}
          {vitals.dualClassName ? ` / ${vitals.dualClassName}` : ""}
        </Text>
      </InfoTip>

      <View style={styles.statGrid}>
        <Stat statKey="str" label="STR" value={s.str} />
        <Stat statKey="int" label="INT" value={s.int} />
        <Stat statKey="wis" label="WIS" value={s.wis} />
        <Stat statKey="dex" label="DEX" value={s.dex} />
        <Stat statKey="con" label="CON" value={s.con} />
        <Stat statKey="cha" label="CHA" value={s.cha} />
        <Stat statKey="lck" label="LCK" value={s.lck} />
        <Stat statKey="align" label="ALIGN" value={vitals.alignment} />
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
            <InfoTip
              key={`${it.vnum}-${i}`}
              title={it.name}
              body={`${it.itemType} · worth ${it.cost} gold${it.description ? `\n\n${it.description}` : ""}`}
              placement="top"
              width={240}
            >
              <View style={styles.invRow}>
                <SvgIcon name={iconForItem(it.itemType)} size={18} color={theme.accent} />
                <Text style={styles.invName} numberOfLines={1}>{it.name}</Text>
                <View style={styles.invPrice}>
                  <SvgIcon name={ICON.gold} size={12} color={theme.gold} />
                  <Text style={styles.invCost}>{it.cost}</Text>
                </View>
              </View>
            </InfoTip>
          ))}
        </ScrollView>
      )}
      <Text style={styles.note}>Worn gear & item stats — roadmap.</Text>
    </View>
  );
}

export function SkillsPanel({ skills, label }: { skills: SkillInfo[]; label: string }) {
  const spells = skills.filter((s) => s.type.toLowerCase() === "spell");
  const abilities = skills.filter((s) => s.type.toLowerCase() !== "spell");
  const available = skills.filter((s) => s.available).length;
  return (
    <View style={styles.panel}>
      <View style={styles.invHead}>
        <SvgIcon name="magic-swirl" size={18} color={theme.violet} />
        <Text style={styles.title}>Skills & Spells</Text>
        <Text style={styles.invCount}>{available}/{skills.length}</Text>
      </View>
      {label ? <Text style={styles.subtitle}>{label} · hover a row for its lore</Text> : null}
      {skills.length === 0 ? (
        <Text style={styles.note}>No skill tree loaded.</Text>
      ) : (
        <ScrollView style={styles.skillList} contentContainerStyle={{ gap: 3 }}>
          {abilities.length > 0 && <Text style={styles.section}>Skills</Text>}
          {abilities.map((s) => <SkillRow key={s.name} s={s} />)}
          {spells.length > 0 && <Text style={styles.section}>Spells</Text>}
          {spells.map((s) => <SkillRow key={s.name} s={s} />)}
        </ScrollView>
      )}
      <Text style={styles.note}>Practising & casting — roadmap. This is the class tree.</Text>
    </View>
  );
}

function SkillRow({ s }: { s: SkillInfo }) {
  return (
    <InfoTip
      title={s.name}
      body={s.description || `A ${s.type.toLowerCase()} learned at level ${s.level}.`}
      placement="top"
      width={250}
    >
      <View style={[styles.skillRow, !s.available && styles.skillLocked]}>
        <Text style={[styles.skillLvl, !s.available && styles.skillDim]}>L{s.level}</Text>
        <Text style={[styles.skillName, !s.available && styles.skillDim]} numberOfLines={1}>{s.name}</Text>
        <Text style={styles.skillAdept}>{s.adept}%</Text>
      </View>
    </InfoTip>
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
  skillList: { maxHeight: 320, marginTop: 4 },
  skillRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bgAlt,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 5, paddingHorizontal: 8,
  },
  skillLocked: { borderStyle: "dashed", opacity: 0.8 },
  skillLvl: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 11, width: 30 },
  skillName: { color: theme.bone, fontFamily: fonts.body, fontSize: 12, flex: 1 },
  skillAdept: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  skillDim: { color: theme.dim },
});
