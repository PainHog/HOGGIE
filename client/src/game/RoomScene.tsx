/**
 * The room scene: a top-down "arena" the player reads at a glance. Enemies are clickable tokens
 * across the top, the player's own token sits below, and a compass in the corner walks the exits.
 * Everything is data-driven from the room snapshot + live combat state — no per-room art.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Ellipse } from "react-native-svg";
import type { RoomView, Vitals } from "../protocol";
import type { FxEvent } from "../store";
import { fonts, theme } from "../theme";
import { SvgIcon } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";
import { EnemyToken, PlayerToken } from "./tokens";

const DIR_CMD: Record<string, string> = {
  north: "n", south: "s", east: "e", west: "w", up: "u", down: "d",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const DIR_LABEL: Record<string, string> = {
  north: "N", south: "S", east: "E", west: "W", up: "U", down: "D",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
};
const GRID: (string | null)[][] = [
  ["northwest", "north", "northeast"],
  ["west", null, "east"],
  ["southwest", "south", "southeast"],
];

function CompassCell({ dir, has, onMove }: { dir: string | null; has: Set<string>; onMove: (d: string) => void }) {
  if (!dir) {
    return (
      <View style={[styles.compassCell, styles.compassHub]}>
        <SvgIcon name={ICON.map} size={16} color={theme.dim} />
      </View>
    );
  }
  const active = has.has(dir);
  return (
    <Pressable
      disabled={!active}
      onPress={() => onMove(DIR_CMD[dir]!)}
      style={({ pressed }) => [styles.compassCell, active ? styles.compassOn : styles.compassOff, pressed && active && styles.compassPress]}
    >
      <Text style={[styles.compassLabel, !active && { color: theme.panelBorder }]}>{DIR_LABEL[dir]}</Text>
    </Pressable>
  );
}

function Compass({ exits, onMove }: { exits: RoomView["exits"]; onMove: (d: string) => void }) {
  const has = new Set(exits.map((e) => e.dir));
  const vert = ["up", "down"].filter((d) => has.has(d));
  return (
    <View style={styles.compass}>
      {GRID.map((row, r) => (
        <View key={r} style={styles.compassRow}>
          {row.map((dir, c) => (
            <CompassCell key={c} dir={dir} has={has} onMove={onMove} />
          ))}
        </View>
      ))}
      <View style={styles.compassRow}>
        {(["up", "down"] as const).map((d) => (
          <Pressable
            key={d}
            disabled={!has.has(d)}
            onPress={() => onMove(DIR_CMD[d]!)}
            style={({ pressed }) => [styles.vertBtn, has.has(d) ? styles.compassOn : styles.compassOff, pressed && has.has(d) && styles.compassPress]}
          >
            <Text style={[styles.compassLabel, !has.has(d) && { color: theme.panelBorder }]}>{DIR_LABEL[d]}{has.has(d) ? "" : ""}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.compassHint}>{vert.length ? "walk · up/down too" : "walk"}</Text>
    </View>
  );
}

export function RoomScene({
  room,
  vitals,
  selfId,
  mobHp,
  engagedTargetId,
  fx,
  onMove,
  onEngage,
}: {
  room: RoomView | null;
  vitals: Vitals | null;
  selfId: string | null;
  mobHp: Record<string, number>;
  engagedTargetId: string | null;
  fx: FxEvent[];
  onMove: (dir: string) => void;
  onEngage: (mobId: string) => void;
}) {
  // Corpses linger briefly (death animation) then leave the scene, without a server round-trip.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    // reset removals whenever we change rooms
    setRemoved(new Set());
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
  }, [room?.vnum]);

  useEffect(() => {
    if (!room) return;
    for (const mob of room.mobs) {
      const hp = mobHp[mob.id] ?? mob.hpPct;
      if (hp <= 0 && !timers.current[mob.id]) {
        timers.current[mob.id] = setTimeout(() => {
          setRemoved((cur) => new Set(cur).add(mob.id));
        }, 1100);
      }
    }
  }, [room, mobHp]);

  const mobs = (room?.mobs ?? []).filter((m) => !removed.has(m.id));

  return (
    <View style={styles.arena}>
      <View style={styles.header}>
        <Text style={styles.roomName} numberOfLines={1}>{room?.name ?? "The Void"}</Text>
        <Text style={styles.sector}>{room?.sector ?? ""}</Text>
      </View>

      <Compass exits={room?.exits ?? []} onMove={onMove} />

      <View style={styles.enemyRow}>
        {mobs.length === 0 ? (
          <Text style={styles.empty}>Nothing stirs here.</Text>
        ) : (
          mobs.map((mob) => (
            <EnemyToken
              key={mob.id}
              mob={mob}
              hpPct={mobHp[mob.id] ?? mob.hpPct}
              engaged={mob.id === engagedTargetId}
              dead={(mobHp[mob.id] ?? mob.hpPct) <= 0}
              fx={fx}
              onEngage={onEngage}
            />
          ))
        )}
      </View>

      <View style={styles.ground} pointerEvents="none">
        <Svg width="80%" height={40} viewBox="0 0 200 40">
          <Ellipse cx="100" cy="20" rx="96" ry="16" fill="#000000" opacity={0.35} />
        </Svg>
      </View>

      <View style={styles.playerRow}>
        {vitals && (
          <PlayerToken
            id={selfId ?? "__self__"}
            self={{ name: vitals.name, level: vitals.level }}
            hpPct={vitals.maxHp > 0 ? vitals.hp / vitals.maxHp : 0}
            fx={fx}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arena: {
    flex: 1,
    backgroundColor: theme.bgAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.panelBorder,
    padding: 12,
    overflow: "hidden",
  },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  roomName: { color: theme.gold, fontFamily: fonts.display, fontSize: 20, flexShrink: 1 },
  sector: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, textTransform: "lowercase" },

  compass: { position: "absolute", top: 44, right: 10, alignItems: "center", zIndex: 3 },
  compassRow: { flexDirection: "row" },
  compassCell: {
    width: 30, height: 26, margin: 1, borderRadius: 5, alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  vertBtn: {
    width: 46, height: 22, margin: 1, borderRadius: 5, alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  compassHub: { borderColor: "transparent", backgroundColor: "transparent" },
  compassOn: { backgroundColor: theme.panel, borderColor: theme.accentDim },
  compassOff: { backgroundColor: "transparent", borderColor: "#20242e" },
  compassPress: { backgroundColor: theme.accentDim },
  compassLabel: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 11 },
  compassHint: { color: theme.dim, fontFamily: fonts.body, fontSize: 9, marginTop: 2 },

  enemyRow: {
    flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "flex-start",
    gap: 6, paddingTop: 18, minHeight: 120,
  },
  empty: { color: theme.dim, fontFamily: fonts.body, fontStyle: "italic", marginTop: 40 },
  ground: { alignItems: "center", marginTop: -6 },
  playerRow: { alignItems: "center", marginTop: -8 },
});
