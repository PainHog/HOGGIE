/**
 * DebugOverlay — a small always-on-top "Debug" button (bottom-right). Tapping it opens a panel
 * with the captured log (errors/warnings/events) and a one-tap Copy button, so a bug report is
 * easy to send. Present on every screen, including the loading/auth screens.
 */
import { useEffect, useReducer, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fonts, theme } from "./theme";
import { clearDebug, debugEntries, debugErrorCount, debugReport, subscribeDebug } from "./debug";

const LEVEL_COLOR: Record<string, string> = { error: "#d9534f", warn: "#c9a227", info: "#6aa9b8" };

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeDebug(() => force()), []);

  const errors = debugErrorCount();
  const entries = debugEntries();

  const copy = async () => {
    const text = debugReport();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* clipboard blocked — the log Text below is selectable as a fallback */
    }
  };

  return (
    <>
      <Pressable style={[styles.fab, errors > 0 && styles.fabErr]} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.fabText}>Debug{errors > 0 ? ` ${errors}` : ""}</Text>
      </Pressable>

      {open && (
        <View style={styles.panel} pointerEvents="box-none">
          <View style={styles.panelInner}>
            <View style={styles.head}>
              <Text style={styles.title}>Debug log</Text>
              <View style={styles.actions}>
                <Btn label={copied ? "Copied!" : "Copy"} onPress={copy} primary />
                <Btn label="Clear" onPress={clearDebug} />
                <Btn label="Close" onPress={() => setOpen(false)} />
              </View>
            </View>
            <Text style={styles.hint}>
              {Platform.OS === "web" ? "Copy, then paste it to me." : "Long-press the text to select + copy."}
            </Text>
            <ScrollView style={styles.log} contentContainerStyle={{ padding: 8 }}>
              {entries.length === 0 ? (
                <Text style={styles.empty}>No log entries yet.</Text>
              ) : (
                entries.map((e, i) => (
                  <Text key={i} style={[styles.line, { color: LEVEL_COLOR[e.level] ?? theme.text }]} selectable>
                    {new Date(e.t).toLocaleTimeString()} {e.level.toUpperCase()} {e.text}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </>
  );
}

function Btn({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, primary && styles.btnPrimary]}>
      <Text style={[styles.btnText, primary && { color: theme.bg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 10, bottom: 10, zIndex: 9999,
    backgroundColor: theme.panelAlt, borderWidth: 1, borderColor: theme.panelBorder,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, opacity: 0.85,
  },
  fabErr: { borderColor: "#d9534f", backgroundColor: "#3a1414" },
  fabText: { color: theme.boneDim, fontFamily: fonts.bodySemi, fontSize: 11 },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 9998, justifyContent: "flex-end", alignItems: "center" },
  panelInner: {
    width: "100%", maxWidth: 720, maxHeight: "70%", backgroundColor: "#0b0b10",
    borderTopWidth: 1, borderColor: theme.panelBorder, borderRadius: 10, padding: 10, marginBottom: 46,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.gold, fontFamily: fonts.displaySemi, fontSize: 16 },
  actions: { flexDirection: "row", gap: 6 },
  hint: { color: theme.dim, fontFamily: fonts.body, fontSize: 11, marginTop: 2, marginBottom: 6 },
  log: { backgroundColor: "#050507", borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, maxHeight: 340 },
  empty: { color: theme.dim, fontFamily: fonts.body, fontStyle: "italic" },
  line: { fontFamily: Platform.select({ web: "ui-monospace, Menlo, monospace", default: "monospace" }), fontSize: 11, lineHeight: 16 },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.bgAlt },
  btnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnText: { color: theme.text, fontFamily: fonts.bodySemi, fontSize: 12 },
});
