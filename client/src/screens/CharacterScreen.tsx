import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components";
import type { Catalog, CharacterSummary, RaceInfo } from "../protocol";
import { fonts, theme } from "../theme";

/** A race may take a class only if it's allowed and not restricted (mirrors the server rule). */
function raceAllowsClass(race: RaceInfo | undefined, className: string): boolean {
  if (!race) return true;
  return !race.restrictedClasses.includes(className) && race.allowedClasses.includes(className);
}

const STAT_KEYS = ["str", "int", "wis", "dex", "con", "cha", "lck"] as const;

/** Compact "STR +2  DEX +2  CON -1" summary of a race's stat modifiers (nonzero only). */
function statSummary(race: RaceInfo): string {
  const parts = STAT_KEYS.map((k) => {
    const v = race.statPlus[k] ?? 0;
    return v ? `${k.toUpperCase()} ${v > 0 ? "+" : ""}${v}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join("  ") : "no stat modifiers";
}

export function CharacterScreen(props: {
  characters: CharacterSummary[];
  catalog: Catalog | null;
  notice: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, raceId: number, classId: number) => void;
  onSignOut: () => void;
  onCredits?: () => void;
}) {
  const races = props.catalog?.races ?? [];
  const classes = props.catalog?.classes ?? [];
  const [name, setName] = useState("");
  // Default to Ghoul (the signature race) + Warrior when present.
  const [raceId, setRaceId] = useState<number>(() => races.find((r) => r.name === "Ghoul")?.id ?? races[0]?.id ?? 15);
  const [classId, setClassId] = useState<number>(() => classes.find((c) => c.name === "Warrior")?.id ?? classes[0]?.id ?? 3);

  const race = useMemo(() => races.find((r) => r.id === raceId), [races, raceId]);
  const selClass = classes.find((c) => c.id === classId);
  const classAllowed = raceAllowsClass(race, selClass?.name ?? "");

  function pickRace(r: RaceInfo) {
    setRaceId(r.id);
    // If the current class isn't allowed for the new race, jump to the first that is.
    if (!raceAllowsClass(r, selClass?.name ?? "")) {
      const ok = classes.find((c) => raceAllowsClass(r, c.name));
      if (ok) setClassId(ok.id);
    }
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Choose your ghoul</Text>

      {props.characters.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Your characters</Text>
          {props.characters.map((c) => (
            <Pressable key={c.id} style={styles.charRow} onPress={() => props.onSelect(c.id)}>
              <Text style={styles.charName}>{c.name}</Text>
              <Text style={styles.charMeta}>L{c.level} {c.race} {c.className}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Create a new one</Text>
        <TextInput
          style={styles.field}
          placeholder="name (letters only)"
          placeholderTextColor={theme.dim}
          autoCapitalize="words"
          autoCorrect={false}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.sub}>Race {races.length ? `(${races.length})` : ""}</Text>
        <View style={styles.chips}>
          {races.map((r) => (
            <Chip key={r.id} label={r.name} active={raceId === r.id} onPress={() => pickRace(r)} />
          ))}
        </View>

        {race && (
          <View style={styles.traitBox}>
            <Text style={styles.traitStats}>{statSummary(race)}</Text>
            <View style={styles.traitRow}>
              {race.resistant.length > 0 && (
                <Text style={styles.traitTag}>
                  <Text style={styles.resistK}>resist</Text> {race.resistant.join(", ")}
                </Text>
              )}
              {race.susceptible.length > 0 && (
                <Text style={styles.traitTag}>
                  <Text style={styles.weakK}>weak</Text> {race.susceptible.join(", ")}
                </Text>
              )}
              <Text style={styles.traitTag}>exp {race.expMultPct}%</Text>
              {race.description.trim().length > 0 && <Text style={styles.loreTag}>lore ✓</Text>}
            </View>
          </View>
        )}

        <Text style={styles.sub}>Class</Text>
        <View style={styles.chips}>
          {classes.map((c) => {
            const allowed = raceAllowsClass(race, c.name);
            return (
              <Chip
                key={c.id}
                label={c.name}
                active={classId === c.id}
                disabled={!allowed}
                onPress={() => allowed && setClassId(c.id)}
              />
            );
          })}
        </View>
        {race && !classAllowed && (
          <Text style={styles.notice}>A {race.name} cannot be a {selClass?.name}.</Text>
        )}

        {props.notice && <Text style={styles.notice}>{props.notice}</Text>}
        <Button label="Enter the world" onPress={() => props.onCreate(name.trim(), raceId, classId)} />
      </View>

      <Button label="Sign out" kind="ghost" onPress={props.onSignOut} />
      {props.onCredits && (
        <Pressable onPress={props.onCredits} style={{ alignSelf: "center", marginBottom: 12 }}>
          <Text style={styles.creditsLink}>Credits & licenses</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}>
      <Text style={[styles.chipText, active && { color: theme.bg, fontFamily: fonts.bodySemi }, disabled && { color: theme.panelBorder }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 18, gap: 16, maxWidth: 560, width: "100%", alignSelf: "center" },
  title: { color: theme.gold, fontSize: 30, fontFamily: fonts.display, marginTop: 8 },
  section: { backgroundColor: theme.panel, borderRadius: 12, borderWidth: 1, borderColor: theme.panelBorder, padding: 16, gap: 8 },
  label: { color: theme.text, fontFamily: fonts.bodySemi, marginBottom: 4 },
  sub: { color: theme.dim, fontSize: 12, marginTop: 6, textTransform: "uppercase", fontFamily: fonts.bodySemi },
  field: { backgroundColor: theme.input, color: theme.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontFamily: fonts.body, borderWidth: 1, borderColor: theme.panelBorder },
  charRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.input, borderRadius: 8, padding: 12 },
  charName: { color: theme.accent, fontFamily: fonts.bodySemi },
  charMeta: { color: theme.dim, fontFamily: fonts.body, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.input },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipDisabled: { opacity: 0.4, borderStyle: "dashed" },
  chipText: { color: theme.text, fontFamily: fonts.body, fontSize: 13 },
  traitBox: { backgroundColor: theme.bgAlt, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, padding: 10, gap: 6 },
  traitStats: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 13 },
  traitRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  traitTag: { color: theme.text, fontFamily: fonts.body, fontSize: 12 },
  resistK: { color: theme.accent, fontFamily: fonts.bodySemi },
  weakK: { color: theme.danger, fontFamily: fonts.bodySemi },
  loreTag: { color: theme.violet, fontFamily: fonts.bodySemi, fontSize: 11 },
  notice: { color: theme.danger, fontSize: 13, fontFamily: fonts.body },
  creditsLink: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 12, textDecorationLine: "underline" },
});
