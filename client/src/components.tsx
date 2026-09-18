/** Reusable UI pieces: colored output pane, command input, vitals + room panels, buttons. */
import { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { COLOR_HEX, type RoomView, type Vitals } from "./protocol";
import type { OutputLine } from "./store";
import { mono, theme } from "./theme";

export function Button(props: { label: string; onPress: () => void; kind?: "primary" | "ghost" }) {
  const primary = props.kind !== "ghost";
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGhost,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.btnText, primary && { color: "#0f1115" }]}>{props.label}</Text>
    </Pressable>
  );
}

/** Scrolling narrative pane; renders color spans and auto-scrolls to the newest line. */
export function OutputPane({ lines }: { lines: OutputLine[] }) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    ref.current?.scrollToEnd({ animated: false });
  }, [lines]);
  return (
    <ScrollView ref={ref} style={styles.output} contentContainerStyle={{ padding: 10 }}>
      {lines.map((ol) => (
        <Text key={ol.id} style={styles.line} selectable>
          {ol.line.length === 0 ? " " : ol.line.map((s, i) => (
            <Text key={i} style={{ color: s.color ? COLOR_HEX[s.color] ?? theme.text : theme.text }}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
    </ScrollView>
  );
}

export function CommandInput({ onSubmit }: { onSubmit: (raw: string) => void }) {
  const ref = useRef<TextInput>(null);
  const value = useRef("");
  return (
    <View style={styles.inputRow}>
      <Text style={styles.prompt}>&gt;</Text>
      <TextInput
        ref={ref}
        style={styles.input}
        placeholder="type a command (look, north, kill rat, say hi, help)…"
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        onChangeText={(t) => (value.current = t)}
        onSubmitEditing={(e) => {
          const raw = e.nativeEvent.text;
          onSubmit(raw);
          value.current = "";
          ref.current?.clear();
          ref.current?.focus();
        }}
        returnKeyType="send"
      />
    </View>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={styles.barWrap}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
        <Text style={styles.barValue}>{value}/{max}</Text>
      </View>
    </View>
  );
}

export function VitalsPanel({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) return <View style={styles.vitals} />;
  return (
    <View style={styles.vitals}>
      <Text style={styles.charName}>
        {vitals.name} — L{vitals.level} {vitals.race} {vitals.className}
      </Text>
      <Bar label="HP" value={vitals.hp} max={vitals.maxHp} color={theme.hp} />
      <Bar label="MP" value={vitals.mana} max={vitals.maxMana} color={theme.mana} />
      <Bar label="MV" value={vitals.move} max={vitals.maxMove} color={theme.move} />
      <Text style={styles.vitalsMeta}>
        <Text style={{ color: theme.gold }}>{vitals.gold}g</Text>  exp {vitals.exp} (tnl {vitals.tnl})  ·  {vitals.position}
      </Text>
    </View>
  );
}

export function RoomPanel({ room }: { room: RoomView | null }) {
  if (!room) return <View style={styles.room} />;
  return (
    <View style={styles.room}>
      <Text style={styles.roomName}>{room.name}</Text>
      <Text style={styles.roomLabel}>Exits</Text>
      <Text style={styles.roomVal}>{room.exits.length ? room.exits.join(", ") : "none"}</Text>
      {room.players.length > 0 && (
        <>
          <Text style={styles.roomLabel}>Players</Text>
          <Text style={styles.roomVal}>{room.players.join(", ")}</Text>
        </>
      )}
      {room.mobs.length > 0 && (
        <>
          <Text style={styles.roomLabel}>Here</Text>
          {room.mobs.map((m, i) => (
            <Text key={i} style={[styles.roomVal, { color: theme.accent }]}>{m}</Text>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", marginVertical: 4 },
  btnPrimary: { backgroundColor: theme.accent },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.panelBorder },
  btnText: { color: theme.text, fontWeight: "600" },
  output: { flex: 1, backgroundColor: theme.bg },
  line: { color: theme.text, fontFamily: mono, fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.input, borderTopWidth: 1, borderTopColor: theme.panelBorder, paddingHorizontal: 10 },
  prompt: { color: theme.accent, fontFamily: mono, fontSize: 16, marginRight: 8 },
  input: { flex: 1, color: theme.text, fontFamily: mono, fontSize: 15, paddingVertical: 12, outlineStyle: "none" } as object,
  vitals: { backgroundColor: theme.panel, borderBottomWidth: 1, borderBottomColor: theme.panelBorder, padding: 10, gap: 4 },
  charName: { color: theme.accent, fontFamily: mono, fontWeight: "700", marginBottom: 2 },
  vitalsMeta: { color: theme.dim, fontFamily: mono, fontSize: 12, marginTop: 2 },
  barWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { color: theme.dim, fontFamily: mono, fontSize: 12, width: 24 },
  barTrack: { flex: 1, height: 16, backgroundColor: "#0c0e12", borderRadius: 4, overflow: "hidden", justifyContent: "center" },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, opacity: 0.85 },
  barValue: { color: theme.text, fontFamily: mono, fontSize: 11, textAlign: "center" },
  room: { backgroundColor: theme.panel, padding: 12, gap: 2, minWidth: 180 },
  roomName: { color: theme.gold, fontFamily: mono, fontWeight: "700", marginBottom: 6 },
  roomLabel: { color: theme.dim, fontFamily: mono, fontSize: 11, marginTop: 6, textTransform: "uppercase" },
  roomVal: { color: theme.text, fontFamily: mono, fontSize: 13 },
});
