/**
 * The live-combat controls: the stance dial (berserk/aggressive/normal/defensive/evasive), a flee
 * button, and a SpellBar. Combat stays melee-only in v1 — auto-attacks run each round once engaged
 * — so these are the only live inputs. The SpellBar is a real, spell-READY shell: when casting is
 * wired later it takes a list of castable spells and emits a cast; adding it needs no layout change.
 */
import { StyleSheet, Text, View } from "react-native";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON, STANCE_ICON } from "../art/iconMap";
import { Tappable } from "../components";

const STANCES: { cmd: string; label: string; position: string }[] = [
  { cmd: "berserk", label: "Berserk", position: "berserk" },
  { cmd: "aggressive", label: "Aggr", position: "aggressive" },
  { cmd: "normal", label: "Normal", position: "standing" },
  { cmd: "defensive", label: "Defend", position: "defensive" },
  { cmd: "evasive", label: "Evade", position: "evasive" },
];

/** A castable spell the SpellBar would show. Empty in v1; the type is here so wiring later is a slot-in. */
export interface CastableSpell {
  id: string;
  name: string;
  icon?: IconName;
  manaCost: number;
  ready: boolean;
}

export function ActionBar({
  position,
  inCombat,
  spells = [],
  onStance,
  onFlee,
  onCast,
}: {
  position: string;
  inCombat: boolean;
  spells?: CastableSpell[];
  onStance: (cmd: string) => void;
  onFlee: () => void;
  onCast?: (spellId: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.groupLabel}>Stance</Text>
        {STANCES.map((s) => {
          const active = position === s.position;
          return (
            <Tappable
              key={s.cmd}
              onPress={() => onStance(s.cmd)}
              style={[styles.stance, active && styles.stanceActive]}
            >
              <SvgIcon name={STANCE_ICON[s.position] ?? "sword-brandish"} size={20} color={active ? theme.bg : theme.accent} />
              <Text style={[styles.stanceText, active && { color: theme.bg }]}>{s.label}</Text>
            </Tappable>
          );
        })}
        <Tappable onPress={onFlee} style={[styles.flee, !inCombat && styles.dimBtn]}>
          <SvgIcon name={ICON.flee} size={20} color={inCombat ? theme.bone : theme.dim} />
          <Text style={[styles.stanceText, { color: inCombat ? theme.bone : theme.dim }]}>Flee</Text>
        </Tappable>
      </View>

      <SpellBar spells={spells} onCast={onCast} />
    </View>
  );
}

/** Spell-ready shell: renders castable spells (none in v1) or a "roadmap" placeholder strip. */
export function SpellBar({ spells = [], onCast }: { spells?: CastableSpell[]; onCast?: (id: string) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.groupLabel}>Spells</Text>
      {spells.length === 0 ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.spellSlot}>
              <SvgIcon name={ICON.mana} size={16} color={theme.panelBorder} />
            </View>
          ))}
          <Text style={styles.roadmap}>casting — roadmap</Text>
        </>
      ) : (
        spells.map((sp) => (
          <Tappable
            key={sp.id}
            onPress={() => sp.ready && onCast?.(sp.id)}
            style={[styles.spell, !sp.ready && styles.dimBtn]}
          >
            <SvgIcon name={sp.icon ?? ICON.mana} size={18} color={sp.ready ? theme.mana : theme.dim} />
            <Text style={styles.spellText}>{sp.name}</Text>
            <Text style={styles.mana}>{sp.manaCost}</Text>
          </Tappable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.panel, borderTopWidth: 1, borderTopColor: theme.panelBorder,
    paddingHorizontal: 10, paddingVertical: 8, gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  groupLabel: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 10, width: 46, textTransform: "uppercase" },
  stance: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 7, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.bgAlt,
  },
  stanceActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  stanceText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12 },
  flee: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 7, borderWidth: 1, borderColor: theme.bloodDim, backgroundColor: theme.bloodDim,
  },
  dimBtn: { opacity: 0.5, backgroundColor: theme.bgAlt, borderColor: theme.panelBorder },
  spellSlot: {
    width: 32, height: 32, borderRadius: 7, borderWidth: 1, borderColor: theme.panelBorder,
    borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: theme.bgAlt,
  },
  roadmap: { color: theme.dim, fontFamily: fonts.body, fontStyle: "italic", fontSize: 11, marginLeft: 4 },
  spell: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 7, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.bgAlt,
  },
  spellText: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 12 },
  mana: { color: theme.mana, fontFamily: fonts.bodySemi, fontSize: 11 },
});
