import { useEffect, useReducer, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GameConnection } from "../net";
import { initialState, reducer } from "../store";
import { CharacterScreen } from "./CharacterScreen";
import { GameScreen } from "./GameScreen";
import { fonts, theme } from "../theme";

/** Owns the WebSocket connection + game state, and routes to the right screen by phase. */
export function GameRoot({
  token,
  onSignOut,
  onCredits,
}: {
  token: string;
  onSignOut: () => void;
  onCredits: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const connRef = useRef<GameConnection | null>(null);

  useEffect(() => {
    const conn = new GameConnection(
      (m) => dispatch({ type: "server", msg: m }),
      () => {
        /* socket closed; App can re-mount on reconnect */
      },
    );
    connRef.current = conn;
    conn.connect(token);
    return () => conn.close();
  }, [token]);

  if (state.phase === "connecting") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.msg}>Entering the shared world…</Text>
      </View>
    );
  }

  if (state.phase === "characters") {
    return (
      <CharacterScreen
        characters={state.characters}
        catalog={state.catalog}
        notice={state.notice}
        onSelect={(id) => connRef.current?.send({ t: "char_select", characterId: id })}
        onCreate={(name, raceId, classId, secondClassId) =>
          connRef.current?.send({ t: "char_create", name, raceId, classId, secondClassId })
        }
        onSignOut={onSignOut}
        onCredits={onCredits}
      />
    );
  }

  return (
    <GameScreen
      state={state}
      onCmd={(raw) => connRef.current?.cmd(raw)}
      onEngage={(mobId) => {
        connRef.current?.target(mobId);
        dispatch({ type: "engage", mobId }); // optimistic: light the foe up the instant it's tapped
      }}
      onSignOut={onSignOut}
      onCredits={onCredits}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, gap: 12 },
  msg: { color: theme.dim, fontFamily: fonts.body },
});
