/**
 * Side panels: a Character sheet (real stats from the server) and an Inventory list (real carried
 * items from the server). Equipment slots are still shells (worn gear is roadmap), but the inventory
 * now reflects what the character is actually holding, so shops (buy/sell) are visible in the UI.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Catalog, EquippedItem, InventoryItem, PartyView, SkillInfo, Vitals } from "../protocol";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";
import { InfoTip } from "../ui/InfoTip";
import { STAT_INFO } from "../data/statInfo";
import { ActionSheet, BagModal, type Sheet, type SheetAction } from "./Interact";

const WEARABLE = new Set(["armor", "weapon", "worn", "light", "artarmor", "artweapon", "artworn"]);

/** Consumable/usable item types → the primary "use it" action shown on the item sheet. */
const USE_VERB: Record<string, { label: string; cmd: string; tone?: "attack" | "good" }> = {
  potion: { label: "Quaff", cmd: "quaff", tone: "good" },
  scroll: { label: "Recite", cmd: "recite" },
  pill: { label: "Eat", cmd: "eat", tone: "good" },
  food: { label: "Eat", cmd: "eat" },
  wand: { label: "Zap a foe", cmd: "zap", tone: "attack" },
  staff: { label: "Brandish", cmd: "brandish", tone: "attack" },
};

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

function Slot({ icon, label, item, onRemove }: { icon: IconName; label: string; item?: EquippedItem; onRemove?: (item: EquippedItem) => void }) {
  return (
    <Pressable disabled={!item} onPress={() => item && onRemove?.(item)} style={({ pressed }) => [styles.slot, item && styles.slotFilled, pressed && item && { opacity: 0.7 }]}>
      <SvgIcon name={icon} size={22} color={item ? theme.accent : theme.panelBorder} />
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={item ? styles.slotItem : styles.slotEmpty} numberOfLines={1}>{item ? item.name : "empty"}</Text>
    </Pressable>
  );
}

export function CharacterPanel({ vitals, catalog, equipment = [], onCmd }: { vitals: Vitals | null; catalog?: Catalog | null; equipment?: EquippedItem[]; onCmd?: (raw: string) => void }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const removeSheet = (item: EquippedItem) => setSheet({
    title: item.name, subtitle: `worn: ${item.slot}`,
    actions: [{ label: "Remove", run: () => onCmd?.(`remove ${item.name}`) }, { label: "Look closer", run: () => onCmd?.(`look ${item.name}`) }],
  });
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
      {(vitals.clan || vitals.pk) && (
        <Text style={styles.subtitle}>
          {vitals.clan ? `Clan: ${vitals.clan}` : ""}
          {vitals.clan && vitals.pk ? "  ·  " : ""}
          {vitals.pk ? "PvP enabled" : ""}
        </Text>
      )}

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
        <Slot icon={ICON.slotHead} label="Head" item={bySlot("head")} onRemove={removeSheet} />
        <Slot icon={ICON.slotBody} label="Body" item={bySlot("body")} onRemove={removeSheet} />
        <Slot icon={ICON.slotWeapon} label="Weapon" item={bySlot("wield")} onRemove={removeSheet} />
      </View>
      {equipment.filter((e) => !["head", "body", "wield"].includes(e.slot)).length > 0 && (
        <View style={styles.eqExtra}>
          {equipment.filter((e) => !["head", "body", "wield"].includes(e.slot)).map((e) => (
            <Pressable key={e.slot} disabled={!onCmd} onPress={() => removeSheet(e)}>
              <Text style={styles.eqLine} numberOfLines={1}><Text style={styles.eqSlot}>{e.slot}: </Text>{e.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.note}>Tap a worn item to remove it.</Text>
      <ActionSheet sheet={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

export function InventoryPanel({ items, onCmd }: { items: InventoryItem[]; onCmd?: (raw: string) => void }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [bagVnum, setBagVnum] = useState<number | null>(null);
  const openItem = (it: InventoryItem) => {
    if (it.container) { setBagVnum(it.vnum); return; } // a bag opens the manager, not a sheet
    const actions: SheetAction[] = [];
    const use = USE_VERB[it.itemType];
    if (use) actions.push({ label: use.label, tone: use.tone, run: () => onCmd?.(`${use.cmd} ${it.name}`) });
    if (WEARABLE.has(it.itemType)) actions.push({ label: "Equip", tone: "good", run: () => onCmd?.(`wear ${it.name}`) });
    actions.push({ label: "Examine", run: () => onCmd?.(`look ${it.name}`) });
    actions.push({ label: "Drop", tone: "attack", run: () => onCmd?.(`drop ${it.name}`) });
    setSheet({ title: it.name, subtitle: `${it.itemType} · worth ${it.cost} gold`, actions });
  };
  // Re-derive the open bag from the latest items each render so its contents stay live after get/put.
  const bag = bagVnum != null ? items.find((i) => i.vnum === bagVnum && i.container) ?? null : null;
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
              <Pressable
                key={`${it.vnum}-${i}`}
                onPress={() => onCmd && openItem(it)}
                style={({ pressed }) => [styles.invRow, wearable && styles.invWearable, pressed && { opacity: 0.7 }]}
              >
                <SvgIcon name={iconForItem(it.itemType)} size={18} color={theme.accent} />
                <Text style={styles.invName} numberOfLines={1}>{it.name}</Text>
                {it.container ? <Text style={styles.invWear}>open</Text> : wearable ? <Text style={styles.invWear}>equip</Text> : null}
                <View style={styles.invPrice}>
                  <SvgIcon name={ICON.gold} size={12} color={theme.gold} />
                  <Text style={styles.invCost}>{it.cost}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <Text style={styles.note}>Tap an item to use it · tap a bag to open it.</Text>
      <ActionSheet sheet={sheet} onClose={() => setSheet(null)} />
      <BagModal bag={bag} pack={items} onCmd={(raw) => onCmd?.(raw)} onClose={() => setBagVnum(null)} />
    </View>
  );
}

/** The party roster: each group member's live HP, who leads, and who's in the room with you. */
export function PartyPanel({ party, onCmd }: { party: PartyView | null; onCmd?: (raw: string) => void }) {
  if (!party || party.members.length === 0) return null;
  const iLead = !!party.members.find((m) => m.self)?.leader;
  return (
    <View style={styles.panel}>
      <View style={styles.invHead}>
        <SvgIcon name={ICON.player} size={18} color={theme.accent} />
        <Text style={styles.title}>Party</Text>
        <Text style={styles.invCount}>{party.members.length}</Text>
      </View>
      {party.members.map((m) => (
        <View key={m.id} style={[styles.partyRow, m.self && styles.partySelf]}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.partyName} numberOfLines={1}>{m.leader ? "♦ " : ""}{m.name}{m.self ? " (you)" : ""} <Text style={styles.partyLvl}>L{m.level}</Text></Text>
            <View style={styles.partyTrack}><View style={[styles.partyHp, { width: `${Math.round(Math.max(0, Math.min(1, m.hpPct)) * 100)}%` }]} /></View>
          </View>
          <Text style={[styles.partyHere, { color: m.here ? theme.accent : theme.dim }]}>{m.here ? "here" : "away"}</Text>
          {iLead && !m.self && (
            <Pressable onPress={() => onCmd?.(`ungroup ${m.name}`)} style={({ pressed }) => [styles.partyKick, pressed && { opacity: 0.6 }]}><Text style={styles.partyKickText}>✕</Text></Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={() => onCmd?.("ungroup")} style={({ pressed }) => [styles.partyLeave, pressed && { opacity: 0.7 }]}>
        <Text style={styles.partyLeaveText}>{iLead ? "Disband group" : "Leave group"}</Text>
      </Pressable>
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

export function SkillsPanel({ skills, label, onCmd }: { skills: SkillInfo[]; label: string; onCmd?: (raw: string) => void }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const spells = skills.filter((s) => s.type.toLowerCase() === "spell");
  const abilities = skills.filter((s) => s.type.toLowerCase() !== "spell");
  const available = skills.filter((s) => s.available).length;
  const open = (s: SkillInfo) => {
    if (!s.available || !onCmd) return;
    const isSpell = s.type.toLowerCase() === "spell";
    const actions: SheetAction[] = [];
    if (isSpell) actions.push({ label: s.mana ? `Cast (${s.mana} mana)` : "Cast", tone: "good", run: () => onCmd(`cast ${s.name}`) });
    actions.push({ label: "Practise", run: () => onCmd(`practice ${s.name}`) });
    setSheet({ title: s.name, subtitle: `${s.type} · L${s.level} · learned ${s.learned ?? 0}/${s.adept}%`, actions });
  };
  return (
    <View style={styles.panel}>
      <View style={styles.invHead}>
        <SvgIcon name="magic-swirl" size={18} color={theme.violet} />
        <Text style={styles.title}>Skills & Spells</Text>
        <Text style={styles.invCount}>{available}/{skills.length}</Text>
      </View>
      {label ? <Text style={styles.subtitle}>{label} · tap an unlocked spell to cast or practise</Text> : null}
      {skills.length === 0 ? (
        <Text style={styles.note}>No skill tree loaded.</Text>
      ) : (
        <ScrollView style={styles.skillList} contentContainerStyle={{ gap: 3 }}>
          {abilities.length > 0 && <Text style={styles.section}>Skills</Text>}
          {abilities.map((s) => <SkillRow key={s.name} s={s} onOpen={open} />)}
          {spells.length > 0 && <Text style={styles.section}>Spells</Text>}
          {spells.map((s) => <SkillRow key={s.name} s={s} onOpen={open} />)}
        </ScrollView>
      )}
      <Text style={styles.note}>Tap a spell to cast it on your foe (or yourself); practise at a guildmaster to raise learned%.</Text>
      <ActionSheet sheet={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}

function SkillRow({ s, onOpen }: { s: SkillInfo; onOpen?: (s: SkillInfo) => void }) {
  const learned = s.learned ?? 0;
  const atCap = s.available && learned >= s.adept;
  const pct = Math.max(0, Math.min(100, s.adept > 0 ? (learned / s.adept) * 100 : 0));
  const isSpell = s.type.toLowerCase() === "spell";
  return (
    <InfoTip
      title={s.name}
      body={`${s.description || `A ${s.type.toLowerCase()} learned at level ${s.level}.`}${s.available ? `\n\nLearned ${learned}% of ${s.adept}% adept cap.${atCap ? " Mastered." : isSpell ? " Tap to cast or practise." : " Tap to practise at a guildmaster."}` : `\n\nUnlocks at level ${s.level}.`}`}
      placement="top"
      width={250}
    >
      <Pressable
        disabled={!s.available || !onOpen}
        onPress={() => onOpen?.(s)}
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
  partyRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.bgAlt,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, paddingVertical: 6, paddingHorizontal: 8, marginTop: 4,
  },
  partySelf: { borderColor: theme.accent },
  partyName: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 12 },
  partyLvl: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  partyTrack: { height: 5, borderRadius: 3, backgroundColor: theme.bg, overflow: "hidden" },
  partyHp: { height: 5, backgroundColor: theme.danger },
  partyHere: { fontFamily: fonts.bodySemi, fontSize: 10, textTransform: "uppercase" },
  partyKick: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.danger, alignItems: "center", justifyContent: "center" },
  partyKickText: { color: theme.danger, fontFamily: fonts.bodySemi, fontSize: 12 },
  partyLeave: { marginTop: 8, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.bloodDim, backgroundColor: theme.bg, alignItems: "center" },
  partyLeaveText: { color: theme.blood, fontFamily: fonts.bodySemi, fontSize: 12 },
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
