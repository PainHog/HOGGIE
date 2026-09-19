/** Reusable UI pieces: buttons, the scrolling combat log, and the command input. */
import { useEffect, useRef, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { COLOR_HEX } from "./protocol";
import type { OutputLine } from "./store";
import { fonts, mono, theme } from "./theme";

export function Button(props: { label: string; onPress: () => void; kind?: "primary" | "ghost" }) {
  const primary = props.kind !== "ghost";
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [styles.btn, primary ? styles.btnPrimary : styles.btnGhost, pressed && { opacity: 0.75 }]}
    >
      <Text style={[styles.btnText, primary && { color: theme.bg }]}>{props.label}</Text>
    </Pressable>
  );
}

/** Generic pressable wrapper with a pressed-state dim, so callers only pass style + children. */
export function Tappable({
  children,
  onPress,
  disabled,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [style, pressed && !disabled && { opacity: 0.75 }]}>
      {children}
    </Pressable>
  );
}

/** The combat/narrative log — colored spans, auto-scrolls to the newest line. */
export function OutputPane({ lines }: { lines: OutputLine[] }) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    ref.current?.scrollToEnd({ animated: false });
  }, [lines]);
  return (
    <ScrollView ref={ref} style={styles.output} contentContainerStyle={{ padding: 10 }}>
      {lines.map((ol) => (
        <Text key={ol.id} style={styles.line} selectable>
          {ol.line.length === 0
            ? " "
            : ol.line.map((s, i) => (
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
        placeholder="commands still work: look, kill rat, say hi, help…"
        placeholderTextColor={theme.dim}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        onChangeText={(t) => (value.current = t)}
        onSubmitEditing={(e) => {
          onSubmit(e.nativeEvent.text);
          value.current = "";
          ref.current?.clear();
          ref.current?.focus();
        }}
        returnKeyType="send"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", marginVertical: 4 },
  btnPrimary: { backgroundColor: theme.accent },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.panelBorder },
  btnText: { color: theme.text, fontFamily: fonts.bodySemi, fontWeight: "600" },
  output: { flex: 1, backgroundColor: theme.bg },
  line: { color: theme.text, fontFamily: mono, fontSize: 13, lineHeight: 19 },
  inputRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: theme.input,
    borderTopWidth: 1, borderTopColor: theme.panelBorder, paddingHorizontal: 10,
  },
  prompt: { color: theme.accent, fontFamily: mono, fontSize: 16, marginRight: 8 },
  input: { flex: 1, color: theme.text, fontFamily: mono, fontSize: 14, paddingVertical: 11, outlineStyle: "none" } as object,
});
