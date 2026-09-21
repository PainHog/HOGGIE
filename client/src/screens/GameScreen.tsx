/**
 * The visual game: a vitals HUD, the room scene (click to move / engage), the live-combat action
 * bar, and side panels (map, character, inventory). The classic command line + a collapsible log
 * are kept for power users — the whole engine is still driven by the same protocol underneath.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { CommandInput, OutputPane } from "../components";
import type { GameState } from "../store";
import { fonts, theme } from "../theme";
import { SvgIcon, type IconName } from "../art/SvgIcon";
import { ICON } from "../art/iconMap";
import { RoomStage } from "../game/RoomStage";
import { StageHud } from "../game/StageHud";
import { ActionBar } from "../game/ActionBar";
import { Minimap } from "../game/Minimap";
import { CharacterPanel, GroundBar, InventoryPanel, SkillsPanel } from "../game/panels";

type Panel = "none" | "map" | "character" | "inventory" | "skills" | "log";

function ToolButton({ icon, label, active, onPress }: { icon?: IconName; label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tool, active && styles.toolActive]}>
      {icon && <SvgIcon name={icon} size={14} color={active ? theme.bg : theme.accent} />}
      <Text style={[styles.toolText, active && { color: theme.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function GameScreen({
  state,
  onCmd,
  onEngage,
  onSignOut,
  onCredits,
}: {
  state: GameState;
  onCmd: (raw: string) => void;
  onEngage: (mobId: string) => void;
  onSignOut: () => void;
  onCredits: () => void;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 880;
  const [panel, setPanel] = useState<Panel>("none");
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? "none" : p));
  const inCombat = state.engagedTargetId != null;

  // Stage 1 of the visual overhaul: the rendered atmospheric room scene (no movement yet).
  const scene = <RoomStage room={state.room} vitals={state.vitals} />;
  // Castable spells for the SPELLS bar: the character's known combat spells, cheapest first.
  const mana = state.vitals?.mana ?? 0;
  const castable = state.skills
    .filter((s) => s.type === "Spell" && s.available && s.category && s.category !== "utility")
    .sort((a, b) => (a.mana ?? 0) - (b.mana ?? 0))
    .slice(0, 6)
    .map((s) => ({ id: s.name, name: s.name, manaCost: s.mana ?? 0, ready: mana >= (s.mana ?? 0) }));
  const actions = (
    <ActionBar
      position={state.vitals?.position ?? "standing"}
      inCombat={inCombat}
      spells={castable}
      onStance={(cmd) => onCmd(cmd)}
      onFlee={() => onCmd("flee")}
      onCast={(id) => onCmd(`cast ${id}`)}
    />
  );

  const drawerBody = (p: Panel) => {
    if (p === "map") return <Minimap rooms={state.rooms} current={state.room?.vnum ?? null} />;
    if (p === "character") return <CharacterPanel vitals={state.vitals} catalog={state.catalog} equipment={state.equipment} />;
    if (p === "inventory") return <InventoryPanel items={state.inventory} onWear={(name) => onCmd(`wear ${name}`)} />;
    if (p === "skills") return <SkillsPanel skills={state.skills} label={state.skillsLabel} onPractice={(name) => onCmd(`practice ${name}`)} />;
    if (p === "log") return <View style={styles.logBox}><OutputPane lines={state.output} /></View>;
    return null;
  };

  return (
    <View style={styles.wrap}>
      <StageHud vitals={state.vitals} />

      <View style={styles.toolbar}>
        {!wide && <ToolButton icon={ICON.map} label="Map" active={panel === "map"} onPress={() => toggle("map")} />}
        {!wide && <ToolButton icon={ICON.player} label="Hero" active={panel === "character"} onPress={() => toggle("character")} />}
        {!wide && <ToolButton icon={ICON.inventory} label="Bag" active={panel === "inventory"} onPress={() => toggle("inventory")} />}
        {!wide && <ToolButton icon={ICON.skills} label="Skills" active={panel === "skills"} onPress={() => toggle("skills")} />}
        <ToolButton label="Quest" onPress={() => { onCmd("quest"); setPanel("log"); }} />
        <ToolButton label="Log" active={panel === "log"} onPress={() => toggle("log")} />
        <View style={{ flex: 1 }} />
        <ToolButton label="Credits" onPress={onCredits} />
        <ToolButton label="Sign out" onPress={onSignOut} />
      </View>

      <View style={[styles.body, { flexDirection: wide ? "row" : "column" }]}>
        <View style={styles.mainCol}>
          {scene}
          <GroundBar items={state.room?.items ?? []} onGet={(cmd) => onCmd(cmd)} />
          {actions}
        </View>

        {wide && (
          <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
            <Minimap rooms={state.rooms} current={state.room?.vnum ?? null} />
            <CharacterPanel vitals={state.vitals} catalog={state.catalog} equipment={state.equipment} />
            <InventoryPanel items={state.inventory} onWear={(name) => onCmd(`wear ${name}`)} />
            <SkillsPanel skills={state.skills} label={state.skillsLabel} onPractice={(name) => onCmd(`practice ${name}`)} />
          </ScrollView>
        )}
      </View>

      {/* Bottom drawer: on narrow it hosts the selected panel; on wide it hosts the log only. */}
      {panel !== "none" && (wide ? panel === "log" : true) && (
        <ScrollView style={styles.drawer} contentContainerStyle={styles.drawerContent}>
          {drawerBody(panel)}
        </ScrollView>
      )}

      <CommandInput onSubmit={onCmd} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  toolbar: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: theme.bgAlt, borderBottomWidth: 1, borderBottomColor: theme.panelBorder,
  },
  tool: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder, backgroundColor: theme.panel,
  },
  toolActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  toolText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 12 },
  body: { flex: 1 },
  mainCol: { flex: 1, padding: 8, gap: 8 },
  rail: { width: 300, borderLeftWidth: 1, borderLeftColor: theme.panelBorder, backgroundColor: theme.bgAlt },
  railContent: { padding: 10, gap: 10 },
  drawer: { maxHeight: 240, borderTopWidth: 1, borderTopColor: theme.panelBorder, backgroundColor: theme.bgAlt },
  drawerContent: { padding: 10 },
  logBox: { height: 200, backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, overflow: "hidden" },
});
