/**
 * Side panels: a Character sheet (real stats from the server) and an Inventory list (real carried
 * items from the server). Equipment slots are still shells (worn gear is roadmap), but the inventory
 * now reflects what the character is actually holding, so shops (buy/sell) are visible in the UI.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Catalog, EquippedItem, InventoryItem, SkillInfo, Vitals } from "../protocol";
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

function Slot({ icon, label, item }: { icon: IconName; label: string; item?: EquippedItem }) {
  return (
    <View style={[styles.slot, item && styles.slotFilled]}>
      <SvgIcon name={icon} size={22} color={item ? theme.accent : theme.panelBorder} />
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={item ? styles.slotItem : styles.slotEmpty} numberOfLines={1}>{item ? item.name : "empty"}</Text>
    </View>
  );
}

export function CharacterPanel({ vitals, catalog, equipment = [] }: { vitals: Vitals | null; catalog?: Catalog | null; equipment?: EquippedItem[] }) {
  if (!vitals) return null;
  const s = vitals.stats;
  const bySlot = (slot: string) => equipment.find((e) => e.slot === slot);
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
        <Stat statKey="glory" label="GLORY" value={vitals.glory ?? 0} />
      </View>

      <Text style={styles.section}>Equipment</Text>
      <View style={styles.slotRow}>
        <Slot icon={ICON.slotHead} label="Head" item={bySlot("head")} />
        <Slot icon={ICON.slotBody} label="Body" item={bySlot("body")} />
        <Slot icon={ICON.slotWeapon} label="Weapon" item={bySlot("wield")} />
      </View>
      {equipment.filter((e) => !["head", "body", "wield"].includes(e.slot)).length > 0 && (
        <View style={styles.eqExtra}>
          {equipment.filter((e) => !["head", "body", "wield"].includes(e.slot)).map((e) => (
            <Text key={e.slot} style={styles.eqLine} numberOfLines={1}>
              <Text style={styles.eqSlot}>{e.slot}: </Text>{e.name}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.note}>Tap an inventory item to wear it. `remove {"<item>"}` to take it off.</Text>
    </View>
  );
}

export function InventoryPanel({ items, onWear }: { items: InventoryItem[]; onWear?: (name: string) => void }) {
  const WEARABLE = new Set(["armor", "weapon", "worn", "light", "artarmor", "artweapon", "artworn"]);
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
          {items.map((it, i) => {
            const wearable = WEARABLE.has(it.itemType);
            return (
              <InfoTip
                key={`${it.vnum}-${i}`}
                title={it.name}
                body={`${it.itemType} · worth ${it.cost} gold${wearable ? " · tap to equip" : ""}${it.description ? `\n\n${it.description}` : ""}`}
                placement="top"
                width={240}
                pressToToggle={false}
              >
                <Pressable
                  onPress={() => wearable && onWear?.(it.name)}
                  style={({ pressed }) => [styles.invRow, wearable && styles.invWearable, pressed && wearable && { opacity: 0.7 }]}
                >
                  <SvgIcon name={iconForItem(it.itemType)} size={18} color={theme.accent} />
                  <Text style={styles.invName} numberOfLines={1}>{it.name}</Text>
                  {wearable && <Text style={styles.invWear}>equip</Text>}
                  <View style={styles.invPrice}>
                    <SvgIcon name={ICON.gold} size={12} color={theme.gold} />
                    <Text style={styles.invCost}>{it.cost}</Text>
                  </View>
                </Pressable>
              </InfoTip>
            );
          })}
        </ScrollView>
      )}
      <Text style={styles.note}>Tap armour/weapons to equip · {"`remove <item>`"} to take off.</Text>
    </View>
  );
}

/** Items lying in the room (corpses + dropped gear). Tap a corpse to loot it, an item to pick it up. */
export function GroundBar({ items, onGet }: { items: string[]; onGet: (cmd: string) => void }) {
  if (!items || items.length === 0) return null;
  const cmdFor = (name: string) => {
    if (/\bcorpse\b/i.test(name)) return "loot";
    const noun = name.trim().split(/\s+/).pop() ?? name;
    return `get ${noun}`;
  };
  return (
    <View style={styles.ground}>
      <SvgIcon name="two-coins" size={14} color={theme.gold} />
      <Text style={styles.groundLabel}>On the ground:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
        {items.map((name, i) => {
          const corpse = /\bcorpse\b/i.test(name);
          return (
            <Pressable
              key={`${name}-${i}`}
              onPress={() => onGet(cmdFor(name))}
              style={({ pressed }) => [styles.groundChip, corpse && styles.groundCorpse, pressed && { opacity: 0.7 }]}
            >
              <SvgIcon name={corpse ? "tombstone" : "knapsack"} size={13} color={corpse ? theme.blood : theme.accent} />
              <Text style={styles.groundName} numberOfLines={1}>{name}</Text>
              <Text style={styles.groundTake}>{corpse ? "loot" : "get"}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function SkillsPanel({ skills, label, onPractice }: { skills: SkillInfo[]; label: string; onPractice?: (name: string) => void }) {
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
      {label ? <Text style={styles.subtitle}>{label} · tap an unlocked row to practise</Text> : null}
      {skills.length === 0 ? (
        <Text style={styles.note}>No skill tree loaded.</Text>
      ) : (
        <ScrollView style={styles.skillList} contentContainerStyle={{ gap: 3 }}>
          {abilities.length > 0 && <Text style={styles.section}>Skills</Text>}
          {abilities.map((s) => <SkillRow key={s.name} s={s} onPractice={onPractice} />)}
          {spells.length > 0 && <Text style={styles.section}>Spells</Text>}
          {spells.map((s) => <SkillRow key={s.name} s={s} onPractice={onPractice} />)}
        </ScrollView>
      )}
      <Text style={styles.note}>Cast from the SPELLS bar. Practise at a guildmaster to raise learned%.</Text>
    </View>
  );
}

function SkillRow({ s, onPractice }: { s: SkillInfo; onPractice?: (name: string) => void }) {
  const learned = s.learned ?? 0;
  const atCap = s.available && learned >= s.adept;
  const pct = Math.max(0, Math.min(100, s.adept > 0 ? (learned / s.adept) * 100 : 0));
  return (
    <InfoTip
      title={s.name}
      body={`${s.description || `A ${s.type.toLowerCase()} learned at level ${s.level}.`}${s.available ? `\n\nLearned ${learned}% of ${s.adept}% adept cap.${atCap ? " Mastered." : " Tap to practise at a guildmaster."}` : `\n\nUnlocks at level ${s.level}.`}`}
      placement="top"
      width={250}
    >
      <Pressable
        disabled={!s.available || !onPractice}
        onPress={() => onPractice?.(s.name)}
        style={({ pressed }) => [styles.skillRow, !s.available && styles.skillLocked, pressed && s.available && { opacity: 0.7 }]}
      >
        <Text style={[styles.skillLvl, !s.available && styles.skillDim]}>L{s.level}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.skillName, !s.available && styles.skillDim]} numberOfLines={1}>{s.name}</Text>
          {s.available && (
            <View style={styles.profBar}>
              <View style={[styles.profFill, { width: `${pct}%` }, atCap && styles.profFull]} />
            </View>
          )}
        </View>
        <Text style={[styles.skillAdept, atCap && { color: theme.gold }]}>
          {s.available ? `${learned}/${s.adept}%` : `${s.adept}%`}
        </Text>
      </Pressable>
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
  slotFilled: { borderStyle: "solid", borderColor: theme.accentDim, backgroundColor: theme.panelAlt },
  slotItem: { color: theme.bone, fontFamily: fonts.body, fontSize: 9, maxWidth: 90, textAlign: "center" },
  eqExtra: { marginTop: 4, gap: 1 },
  eqLine: { color: theme.boneDim, fontFamily: fonts.body, fontSize: 11 },
  eqSlot: { color: theme.dim, fontFamily: fonts.bodySemi, textTransform: "capitalize" },
  note: { color: theme.dim, fontFamily: fonts.body, fontSize: 10, fontStyle: "italic", marginTop: 4 },
  invHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  invCount: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 12, marginLeft: "auto" },
  invList: { maxHeight: 220, marginTop: 4 },
  invRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bgAlt,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 6, paddingHorizontal: 8,
  },
  invName: { color: theme.bone, fontFamily: fonts.body, fontSize: 12, flex: 1 },
  invWearable: { borderColor: theme.accentDim },
  invWear: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 10, textTransform: "uppercase" },
  invPrice: { flexDirection: "row", alignItems: "center", gap: 3 },
  invCost: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 11 },
  skillList: { maxHeight: 320, marginTop: 4 },
  skillRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bgAlt,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 5, paddingHorizontal: 8,
  },
  skillLocked: { borderStyle: "dashed", opacity: 0.8 },
  skillLvl: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 11, width: 30 },
  skillName: { color: theme.bone, fontFamily: fonts.body, fontSize: 12 },
  skillAdept: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  skillDim: { color: theme.dim },
  profBar: { height: 3, borderRadius: 2, backgroundColor: theme.panelBorder, marginTop: 3, overflow: "hidden" },
  profFill: { height: 3, backgroundColor: theme.accent, borderRadius: 2 },
  profFull: { backgroundColor: theme.gold },
  ground: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.panel,
    borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 6, paddingHorizontal: 8,
  },
  groundLabel: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 11 },
  groundChip: {
    flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: theme.bgAlt,
    borderRadius: 14, borderWidth: 1, borderColor: theme.accentDim, paddingVertical: 4, paddingHorizontal: 9,
  },
  groundCorpse: { borderColor: theme.blood },
  groundName: { color: theme.bone, fontFamily: fonts.body, fontSize: 11, maxWidth: 150 },
  groundTake: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 9, textTransform: "uppercase" },
});
