/**
 * Interaction layer over the room scene: everything a player used to type is now a tap.
 *  - MoveControls: a compass d-pad (closed doors open on tap, then you walk through).
 *  - RoomActors: tap a foe to attack, an NPC for its services (quest/shop/heal/train), an item to grab.
 *  - QuestCard: the active quest with Accept / Turn in / Abandon buttons.
 * Each action just sends the same protocol command the command line would — the engine is unchanged.
 */
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { QuestBrief, RoomMob, RoomView, ShopView, Vitals } from "../protocol";
import { fonts, theme } from "../theme";

export type SheetAction = { label: string; tone?: "attack" | "default" | "good"; run: () => void };
export type Sheet = { title: string; subtitle?: string; actions: SheetAction[] } | null;

/** The primary keyword the server matches a mob/item command against. */
const kw = (mob: RoomMob) => mob.keywords[0] ?? mob.name.split(/\s+/).pop() ?? mob.name;
/** Match a floor item's display string to a get-able keyword (last word is usually the noun). */
const itemKw = (name: string) => name.replace(/[^a-zA-Z ]/g, "").trim().split(/\s+/).pop() ?? name;

const DIRS = [
  ["", "north", ""],
  ["west", "", "east"],
  ["", "south", ""],
] as const;
const SHORT: Record<string, string> = { north: "N", south: "S", east: "E", west: "W", up: "U", down: "D", northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW" };

export function RoomInteractions({
  room, vitals, mobHp, engagedId, onMove, onEngage, onCmd,
}: {
  room: RoomView | null;
  vitals: Vitals | null;
  mobHp: Record<string, number>;
  engagedId: string | null;
  onMove: (dir: string) => void;
  onEngage: (mobId: string) => void;
  onCmd: (raw: string) => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);

  const exitByDir = new Map((room?.exits ?? []).map((e) => [e.dir, e]));
  const step = (dir: string) => {
    const ex = exitByDir.get(dir);
    if (!ex) return;
    if (ex.closed) onCmd(`open ${dir}`); // a closed door opens first; tap again to walk through
    else onMove(dir);
  };

  const mobSheet = (mob: RoomMob) => {
    const alive = (mobHp[mob.id] ?? mob.hpPct) > 0;
    const actions: SheetAction[] = [];
    if (alive) actions.push({ label: "Attack", tone: "attack", run: () => onEngage(mob.id) });
    if (mob.questmaster) actions.push({ label: "Ask for a quest", tone: "good", run: () => onCmd("quest request") });
    if (mob.shopkeeper) actions.push({ label: "Browse wares", run: () => onCmd("list") });
    if (mob.healer) {
      const lvl = vitals?.level ?? 1;
      actions.push({ label: `Full heal (${Math.max(20, lvl * 8)}g)`, tone: "good", run: () => onCmd("heal full") });
      actions.push({ label: `Cure ailments (${Math.max(30, lvl * 12)}g)`, tone: "good", run: () => onCmd("heal cure") });
    }
    if (mob.trainer) actions.push({ label: "Train / practice", run: () => onCmd("practice") });
    actions.push({ label: "Look closer", run: () => onCmd(`look ${kw(mob)}`) });
    setSheet({ title: mob.name, subtitle: `level ${mob.level}${mob.position !== "standing" ? ` · ${mob.position}` : ""}`, actions });
  };

  return (
    <View style={styles.wrap}>
      {/* room contents: tappable foes, NPCs, players, items */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actorRow}>
        {(room?.mobs ?? []).map((mob) => {
          const hp = mobHp[mob.id] ?? mob.hpPct;
          const role = mob.questmaster ? "!" : mob.shopkeeper ? "$" : mob.healer ? "+" : mob.trainer ? "★" : null;
          const dead = hp <= 0;
          return (
            <Pressable key={mob.id} onPress={() => mobSheet(mob)} style={({ pressed }) => [styles.chip, mob.id === engagedId && styles.chipEngaged, dead && styles.chipDead, pressed && styles.chipPress]}>
              <Text style={styles.chipName} numberOfLines={1}>{role ? `${role} ` : ""}{mob.name}</Text>
              <View style={styles.hpTrack}><View style={[styles.hpFill, { width: `${Math.round(Math.max(0, Math.min(1, hp)) * 100)}%` }, dead && { backgroundColor: theme.dim }]} /></View>
            </Pressable>
          );
        })}
        {(room?.players ?? []).map((p) => (
          <Pressable key={p.id} onPress={() => setSheet({ title: p.name, subtitle: `level ${p.level} · adventurer`, actions: [{ label: "Look closer", run: () => onCmd(`look ${p.name}`) }, { label: "Group up", run: () => onCmd(`group ${p.name}`) }] })} style={styles.chipPlayer}>
            <Text style={styles.chipName} numberOfLines={1}>☺ {p.name}</Text>
          </Pressable>
        ))}
        {(room?.items ?? []).map((it, i) => {
          const isCorpse = /\bcorpse\b/i.test(it);
          const actions: SheetAction[] = isCorpse
            ? [{ label: "Loot corpse", tone: "good", run: () => onCmd("loot corpse") }, { label: "Look closer", run: () => onCmd(`look ${itemKw(it)}`) }]
            : [{ label: "Pick up", tone: "good", run: () => onCmd(`get ${itemKw(it)}`) }, { label: "Look closer", run: () => onCmd(`look ${itemKw(it)}`) }];
          return (
            <Pressable key={`it${i}`} onPress={() => setSheet({ title: it, actions })} style={isCorpse ? styles.chipCorpse : styles.chipItem}>
              <Text style={styles.chipItemText} numberOfLines={1}>{isCorpse ? "☠" : "◆"} {it}</Text>
            </Pressable>
          );
        })}
        {(room?.mobs?.length ?? 0) === 0 && (room?.items?.length ?? 0) === 0 && (room?.players?.length ?? 0) === 0 && (
          <Text style={styles.quiet}>Nothing stirs here.</Text>
        )}
      </ScrollView>

      {/* movement d-pad */}
      <View style={styles.pad}>
        <View style={styles.padGrid}>
          {DIRS.map((row, r) => (
            <View key={r} style={styles.padRow}>
              {row.map((dir, c) => <DirCell key={c} dir={dir} exit={dir ? exitByDir.get(dir) : undefined} onPress={step} />)}
            </View>
          ))}
        </View>
        <View style={styles.padVert}>
          {(["up", "down"] as const).map((d) => <DirCell key={d} dir={d} exit={exitByDir.get(d)} onPress={step} wide />)}
        </View>
      </View>

      {/* quest card */}
      <QuestCard quest={vitals?.quest} hasQuestmaster={(room?.mobs ?? []).some((m) => m.questmaster)} onCmd={onCmd} />

      <ActionSheet sheet={sheet} onClose={close} />
    </View>
  );
}

function DirCell({ dir, exit, onPress, wide }: { dir: string; exit?: { closed?: boolean }; onPress: (d: string) => void; wide?: boolean }) {
  if (!dir) return <View style={styles.cell} />;
  const open = !!exit;
  const closed = !!exit?.closed;
  return (
    <Pressable
      disabled={!open}
      onPress={() => onPress(dir)}
      style={({ pressed }) => [wide ? styles.cellWide : styles.cell, open ? styles.cellOn : styles.cellOff, closed && styles.cellDoor, pressed && open && styles.cellPress]}
    >
      <Text style={[styles.cellText, !open && { color: theme.panelBorder }, closed && { color: theme.gold }]}>{closed ? `🔒${SHORT[dir]}` : SHORT[dir]}</Text>
    </Pressable>
  );
}

function QuestCard({ quest, hasQuestmaster, onCmd }: { quest?: QuestBrief; hasQuestmaster: boolean; onCmd: (raw: string) => void }) {
  if (!quest) {
    if (!hasQuestmaster) return null;
    return (
      <View style={styles.quest}>
        <Text style={styles.questTitle}>No active quest</Text>
        <Pressable style={({ pressed }) => [styles.qbtn, styles.qbtnGood, pressed && styles.qpress]} onPress={() => onCmd("quest request")}>
          <Text style={styles.qbtnText}>Ask the questmaster</Text>
        </Pressable>
      </View>
    );
  }
  const obj = quest.kind === "hunt" ? `Slay ${quest.killed ?? 0}/${quest.count ?? 1} ${quest.target}` : `Recover ${quest.target}`;
  return (
    <View style={styles.quest}>
      <Text style={styles.questTitle} numberOfLines={1}>{obj}</Text>
      <Text style={styles.questMeta} numberOfLines={1}>
        {quest.area}{quest.minutesLeft != null ? ` · ${quest.minutesLeft}m left` : ""} · {quest.rewardGold}g / {quest.rewardGlory} glory
      </Text>
      <View style={styles.qrow}>
        <Pressable style={({ pressed }) => [styles.qbtn, quest.fulfilled ? styles.qbtnGood : styles.qbtnDim, pressed && styles.qpress]} disabled={!quest.fulfilled} onPress={() => onCmd("quest complete")}>
          <Text style={[styles.qbtnText, !quest.fulfilled && { color: theme.dim }]}>{quest.fulfilled ? "Turn in" : "In progress"}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.qbtn, styles.qbtnDanger, pressed && styles.qpress]} onPress={() => onCmd("quest abandon")}>
          <Text style={styles.qbtnText}>Abandon</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The tap-to-buy storefront: a shopkeeper's priced stock, each row a Buy button. */
export function ShopModal({ shop, gold, onBuy, onClose }: { shop: ShopView | null; gold: number; onBuy: (name: string) => void; onClose: () => void }) {
  return (
    <Modal transparent visible={!!shop} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.shop} onPress={() => {}}>
          {shop && (
            <>
              <View style={styles.shopHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{shop.keeper}</Text>
                <Text style={styles.shopGold}>{gold} gold</Text>
              </View>
              {shop.items.length === 0 ? (
                <Text style={styles.sheetSub}>Nothing for sale right now.</Text>
              ) : (
                <ScrollView style={styles.shopList} contentContainerStyle={{ gap: 6 }}>
                  {shop.items.map((it, i) => {
                    const afford = gold >= it.price;
                    return (
                      <View key={`${it.vnum}-${i}`} style={styles.shopRow}>
                        <View style={styles.shopInfo}>
                          <Text style={styles.shopName} numberOfLines={1}>{it.name}</Text>
                          <Text style={styles.shopType}>{it.itemType}</Text>
                        </View>
                        <Pressable
                          disabled={!afford}
                          onPress={() => onBuy(it.name)}
                          style={({ pressed }) => [styles.buyBtn, !afford && styles.buyPoor, pressed && afford && styles.sheetPress]}
                        >
                          <Text style={[styles.buyText, !afford && { color: theme.dim }]}>{it.price}g</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
              <Pressable onPress={onClose} style={styles.sheetCancel}><Text style={styles.sheetCancelText}>Done</Text></Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ActionSheet({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  return (
    <Modal transparent visible={!!sheet} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {sheet && (
            <>
              <Text style={styles.sheetTitle} numberOfLines={1}>{sheet.title}</Text>
              {sheet.subtitle ? <Text style={styles.sheetSub}>{sheet.subtitle}</Text> : null}
              {sheet.actions.map((a) => (
                <Pressable key={a.label} onPress={() => { a.run(); onClose(); }} style={({ pressed }) => [styles.sheetBtn, a.tone === "attack" && styles.sheetAttack, a.tone === "good" && styles.sheetGood, pressed && styles.sheetPress]}>
                  <Text style={styles.sheetBtnText}>{a.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={onClose} style={styles.sheetCancel}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  actorRow: { gap: 6, paddingVertical: 2, alignItems: "center", minHeight: 40 },
  chip: { minWidth: 92, maxWidth: 150, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.panel, gap: 4 },
  chipEngaged: { borderColor: theme.danger },
  chipDead: { opacity: 0.45 },
  chipPress: { backgroundColor: theme.bgAlt },
  chipName: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12 },
  hpTrack: { height: 4, borderRadius: 2, backgroundColor: theme.bg, overflow: "hidden" },
  hpFill: { height: 4, backgroundColor: theme.danger },
  chipPlayer: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.panel, justifyContent: "center" },
  chipItem: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.bgAlt, justifyContent: "center" },
  chipCorpse: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.blood, backgroundColor: theme.bgAlt, justifyContent: "center" },
  chipItemText: { color: theme.gold, fontFamily: fonts.body, fontSize: 12 },
  quiet: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, fontStyle: "italic", paddingVertical: 10 },

  pad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  padGrid: { gap: 3 },
  padRow: { flexDirection: "row", gap: 3 },
  padVert: { gap: 3 },
  cell: { width: 42, height: 34, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  cellWide: { width: 54, height: 34, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  cellOn: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.accent },
  cellOff: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.panelBorder },
  cellDoor: { borderColor: theme.gold },
  cellPress: { backgroundColor: theme.accent },
  cellText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 13 },

  quest: { borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.bgAlt, padding: 8, gap: 5 },
  questTitle: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 13 },
  questMeta: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  qrow: { flexDirection: "row", gap: 6 },
  qbtn: { flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: "center", borderWidth: 1, borderColor: theme.panelBorder },
  qbtnGood: { backgroundColor: theme.panel, borderColor: theme.accent },
  qbtnDim: { backgroundColor: theme.bg },
  qbtnDanger: { backgroundColor: theme.bg, borderColor: theme.danger },
  qpress: { opacity: 0.7 },
  qbtnText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12 },

  overlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.bgAlt, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: theme.panelBorder, padding: 14, gap: 8 },
  sheetTitle: { color: theme.gold, fontFamily: fonts.display, fontSize: 18 },
  sheetSub: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, marginTop: -6, marginBottom: 4 },
  sheetBtn: { paddingVertical: 12, borderRadius: 8, alignItems: "center", backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.panelBorder },
  sheetAttack: { borderColor: theme.danger },
  sheetGood: { borderColor: theme.accent },
  sheetPress: { backgroundColor: theme.bg },
  sheetBtnText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 15 },
  sheetCancel: { paddingVertical: 10, alignItems: "center" },
  sheetCancelText: { color: theme.dim, fontFamily: fonts.body, fontSize: 14 },

  shop: { backgroundColor: theme.bgAlt, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: theme.panelBorder, padding: 14, gap: 8, maxHeight: "70%" },
  shopHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shopGold: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 14 },
  shopList: { flexGrow: 0 },
  shopRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, padding: 10 },
  shopInfo: { flex: 1, gap: 2 },
  shopName: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 14 },
  shopType: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  buyBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.gold, backgroundColor: theme.panel },
  buyPoor: { borderColor: theme.panelBorder, backgroundColor: theme.bg },
  buyText: { color: theme.gold, fontFamily: fonts.bodySemi, fontSize: 14 },
});
