/**
 * InfoTip — a cross-platform tooltip/popover that surfaces the captured lore/help text.
 * Web: opens on hover. Mobile (and web tap): toggles on press when `pressToToggle` is set.
 * The popover is anchored to the trigger; keep triggers out of `overflow:"hidden"` containers.
 */
import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { fonts, theme } from "../theme";

export function InfoTip({
  title,
  body,
  children,
  placement = "bottom",
  align = "left",
  width = 240,
  pressToToggle = true,
}: {
  title?: string;
  body: string;
  children: ReactNode;
  placement?: "top" | "bottom";
  align?: "left" | "right" | "center";
  width?: number;
  pressToToggle?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const show = (hover || pinned) && body.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <Pressable
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        onPress={pressToToggle ? () => setPinned((p) => !p) : undefined}
      >
        {children}
      </Pressable>
      {show && (
        <View
          style={[
            styles.pop,
            { width },
            placement === "top" ? styles.popTop : styles.popBottom,
            align === "right" ? { right: 0 } : align === "center" ? { left: "50%", marginLeft: -width / 2 } : { left: 0 },
          ]}
          // On web let the pointer fall through so hover-out fires reliably; on native it's tap-dismissable.
          pointerEvents={Platform.OS === "web" ? "none" : "auto"}
        >
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <Text style={styles.body}>{body}</Text>
        </View>
      )}
    </View>
  );
}

/** A small "i" affordance to hang a tooltip on where there is no natural trigger. */
export function InfoDot({ size = 15, color = theme.violet }: { size?: number; color?: string }) {
  return (
    <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
      <Text style={[styles.dotText, { color, fontSize: size - 5 }]}>i</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 20 },
  pop: {
    position: "absolute",
    zIndex: 999,
    backgroundColor: theme.panelAlt,
    borderWidth: 1,
    borderColor: theme.violet,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    // a soft drop so it reads as floating above the panel
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  popBottom: { top: "100%", marginTop: 6 },
  popTop: { bottom: "100%", marginBottom: 6 },
  title: { color: theme.gold, fontFamily: fonts.displaySemi, fontSize: 14 },
  body: { color: theme.boneDim, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  dot: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dotText: { fontFamily: fonts.bodySemi, lineHeight: 12 },
});
