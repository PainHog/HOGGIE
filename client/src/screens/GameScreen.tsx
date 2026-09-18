import { StyleSheet, View, useWindowDimensions } from "react-native";
import { CommandInput, OutputPane, RoomPanel, VitalsPanel } from "../components";
import type { GameState } from "../store";
import { theme } from "../theme";

/** The live game: vitals on top, scrolling output + room panel, command input at the bottom. */
export function GameScreen({ state, onCmd }: { state: GameState; onCmd: (raw: string) => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;

  return (
    <View style={styles.wrap}>
      <VitalsPanel vitals={state.vitals} />
      <View style={[styles.main, { flexDirection: wide ? "row" : "column" }]}>
        <View style={styles.outputWrap}>
          <OutputPane lines={state.output} />
        </View>
        <View style={[styles.roomWrap, wide ? styles.roomSide : styles.roomBottom]}>
          <RoomPanel room={state.room} />
        </View>
      </View>
      <CommandInput onSubmit={onCmd} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  main: { flex: 1 },
  outputWrap: { flex: 1 },
  roomWrap: { backgroundColor: theme.panel },
  roomSide: { width: 220, borderLeftWidth: 1, borderLeftColor: theme.panelBorder },
  roomBottom: { borderTopWidth: 1, borderTopColor: theme.panelBorder, maxHeight: 160 },
});
