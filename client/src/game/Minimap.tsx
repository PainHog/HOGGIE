/**
 * Minimap — a small graph of the rooms explored so far, laid out from the current room by walking
 * known cardinal exits. Built entirely from accumulated room snapshots (store.rooms), so it fills
 * in as the player moves. Up/down exits aren't drawn in 2D (marked on the node instead).
 */
import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Rect } from "react-native-svg";
import type { KnownRoom } from "../store";
import { fonts, theme } from "../theme";

const OFF: Record<string, [number, number]> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
  northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
};

function layout(rooms: Record<number, KnownRoom>, current: number) {
  const pos = new Map<number, [number, number]>();
  const taken = new Set<string>();
  const place = (vnum: number, x: number, y: number) => {
    if (pos.has(vnum)) return;
    let k = `${x},${y}`;
    let n = 1;
    while (taken.has(k)) { k = `${x + n * 0.01},${y}`; n++; } // nudge on rare collisions
    taken.add(k);
    pos.set(vnum, [x, y]);
  };
  if (!rooms[current]) return pos;
  place(current, 0, 0);
  const queue = [current];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const v = queue.shift()!;
    const [x, y] = pos.get(v)!;
    const room = rooms[v];
    if (!room) continue;
    for (const e of room.exits) {
      const off = OFF[e.dir];
      if (!off || !rooms[e.toVnum]) continue;
      if (!pos.has(e.toVnum)) {
        place(e.toVnum, x + off[0], y + off[1]);
        queue.push(e.toVnum);
      }
    }
  }
  return pos;
}

export function Minimap({ rooms, current }: { rooms: Record<number, KnownRoom>; current: number | null }) {
  const cur = current ?? -1;
  const pos = layout(rooms, cur);
  const nodes = [...pos.entries()];
  if (nodes.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.hint}>explore to chart the area</Text>
      </View>
    );
  }
  const xs = nodes.map(([, p]) => p[0]);
  const ys = nodes.map(([, p]) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cols = maxX - minX + 1, rowsN = maxY - minY + 1;
  const cell = 26, pad = 16;
  const W = cols * cell + pad * 2, H = rowsN * cell + pad * 2;
  const cx = (x: number) => pad + (x - minX) * cell + cell / 2;
  const cy = (y: number) => pad + (y - minY) * cell + cell / 2;

  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const [v, [x, y]] of nodes) {
    const room = rooms[v];
    if (!room) continue;
    for (const e of room.exits) {
      if (OFF[e.dir] && pos.has(e.toVnum)) {
        const [nx, ny] = pos.get(e.toVnum)!;
        edges.push({ x1: cx(x), y1: cy(y), x2: cx(nx), y2: cy(ny) });
      }
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Map</Text>
      <Svg width={W} height={H}>
        {edges.map((e, i) => (
          <Line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={theme.panelBorder} strokeWidth={2} />
        ))}
        {nodes.map(([v, [x, y]]) => {
          const isCur = v === cur;
          const hasVert = (rooms[v]?.exits ?? []).some((e) => e.dir === "up" || e.dir === "down");
          return (
            <Fragment key={v}>
              <Rect
                x={cx(x) - 8} y={cy(y) - 8} width={16} height={16} rx={3}
                fill={isCur ? theme.accent : theme.panelAlt}
                stroke={isCur ? theme.accent : theme.panelBorder}
                strokeWidth={1.5}
              />
              {hasVert && <Circle cx={cx(x) + 7} cy={cy(y) - 7} r={2.5} fill={theme.violet} />}
            </Fragment>
          );
        })}
      </Svg>
      <Text style={styles.hint}>{nodes.length} rooms charted</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, padding: 10, alignItems: "flex-start", gap: 4 },
  title: { color: theme.gold, fontFamily: fonts.displaySemi, fontSize: 14 },
  hint: { color: theme.dim, fontFamily: fonts.body, fontSize: 10 },
});
