import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components";
import type { CharacterSummary } from "../protocol";
import { fonts, theme } from "../theme";

// v1 playable race/class -> content id (from race.lst / class.lst order).
const RACES: { name: string; id: number }[] = [
  { name: "Human", id: 0 },
  { name: "Elf", id: 1 },
  { name: "Ghoul", id: 15 },
];
const CLASSES: { name: string; id: number }[] = [
  { name: "Warrior", id: 3 },
  { name: "Mage", id: 0 },
  { name: "Cleric", id: 1 },
];

export function CharacterScreen(props: {
  characters: CharacterSummary[];
  notice: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, raceId: number, classId: number) => void;
  onSignOut: () => void;
  onCredits?: () => void;
}) {
  const [name, setName] = useState("");
  const [raceId, setRaceId] = useState(15); // Ghoul, the signature race
  const [classId, setClassId] = useState(3); // Warrior

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
        <Text style={styles.sub}>Race</Text>
        <View style={styles.chips}>
          {RACES.map((r) => (
            <Chip key={r.id} label={r.name} active={raceId === r.id} onPress={() => setRaceId(r.id)} />
          ))}
        </View>
        <Text style={styles.sub}>Class</Text>
        <View style={styles.chips}>
          {CLASSES.map((c) => (
            <Chip key={c.id} label={c.name} active={classId === c.id} onPress={() => setClassId(c.id)} />
          ))}
        </View>
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

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: "#0f1115", fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 18, gap: 16, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { color: theme.gold, fontSize: 30, fontFamily: fonts.display, marginTop: 8 },
  section: { backgroundColor: theme.panel, borderRadius: 12, borderWidth: 1, borderColor: theme.panelBorder, padding: 16, gap: 8 },
  label: { color: theme.text, fontFamily: fonts.bodySemi, marginBottom: 4 },
  sub: { color: theme.dim, fontSize: 12, marginTop: 6, textTransform: "uppercase", fontFamily: fonts.bodySemi },
  field: { backgroundColor: theme.input, color: theme.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontFamily: fonts.body, borderWidth: 1, borderColor: theme.panelBorder },
  charRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.input, borderRadius: 8, padding: 12 },
  charName: { color: theme.accent, fontFamily: fonts.bodySemi },
  charMeta: { color: theme.dim, fontFamily: fonts.body, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.input },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontFamily: fonts.body },
  notice: { color: theme.danger, fontSize: 13, fontFamily: fonts.body },
  creditsLink: { color: theme.dim, fontFamily: fonts.bodySemi, fontSize: 12, textDecorationLine: "underline" },
});
