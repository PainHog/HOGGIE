/**
 * Credits — satisfies CC BY 3.0 for the game-icons.net art by naming every icon's artist, with a
 * link to its source page and the license. Generated from the exact icons the app uses
 * (src/art/credits.generated.ts). Fonts (OFL) and Kenney (CC0) need no attribution but are noted
 * for completeness.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { fonts, theme } from "../theme";
import { SvgIcon } from "../art/SvgIcon";
import type { IconName } from "../art/icons.generated";
import { ICON_ARTISTS, ICON_CREDITS, ICON_LICENSE, ICON_SOURCE } from "../art/credits.generated";

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Text style={styles.link} onPress={() => void Linking.openURL(url)}>
      {label}
    </Text>
  );
}

export function CreditsScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.h1}>Credits & Licenses</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          House of Ghouls bundles only free assets — everything below is CC0, OFL, or CC BY 3.0 with
          the attribution required by that license.
        </Text>

        {/* game-icons.net — CC BY 3.0 (attribution required) */}
        <Text style={styles.h2}>Icons — game-icons.net</Text>
        <Text style={styles.lead}>
          Silhouette icons by <Text style={styles.strong}>{ICON_ARTISTS.join(", ")}</Text>, from{" "}
          <Link label={ICON_SOURCE.name} url={ICON_SOURCE.url} />, licensed{" "}
          <Link label={ICON_LICENSE.name} url={ICON_LICENSE.url} />.
        </Text>

        <View style={styles.list}>
          {ICON_CREDITS.map((c) => (
            <Pressable key={c.slug} style={styles.row} onPress={() => void Linking.openURL(c.url)}>
              <View style={styles.iconChip}>
                <SvgIcon name={c.slug as IconName} size={22} color={theme.boneDim} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {c.title} <Text style={styles.rowBy}>by {c.author}</Text>
                </Text>
                <Text style={styles.rowRole}>{c.role} · CC BY 3.0</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Fonts — OFL */}
        <Text style={styles.h2}>Fonts — Google Fonts (OFL 1.1)</Text>
        <View style={styles.list}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Grenze Gotisch <Text style={styles.rowBy}>display</Text></Text>
              <Text style={styles.rowRole}>SIL Open Font License 1.1</Text>
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Spectral <Text style={styles.rowBy}>body</Text></Text>
              <Text style={styles.rowRole}>SIL Open Font License 1.1</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          UI chrome is drawn procedurally (no third-party art). Kenney CC0 assets are approved for
          later use and require no attribution. All assets are bundled locally — the game costs $0 to
          run.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  topbar: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.panelBorder, backgroundColor: theme.panel,
  },
  back: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.panelBorder },
  backText: { color: theme.accent, fontFamily: fonts.bodySemi, fontSize: 14 },
  h1: { color: theme.gold, fontFamily: fonts.display, fontSize: 22 },
  content: { padding: 16, gap: 10, maxWidth: 640, width: "100%", alignSelf: "center" },
  intro: { color: theme.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  h2: { color: theme.accent, fontFamily: fonts.displaySemi, fontSize: 17, marginTop: 12 },
  lead: { color: theme.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  strong: { color: theme.bone, fontFamily: fonts.bodySemi },
  link: { color: theme.gold, fontFamily: fonts.bodySemi, textDecorationLine: "underline" },
  list: { gap: 6, marginTop: 6 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.panel,
    borderRadius: 8, borderWidth: 1, borderColor: theme.panelBorder, padding: 8,
  },
  iconChip: {
    width: 38, height: 38, borderRadius: 6, backgroundColor: theme.bgAlt, alignItems: "center",
    justifyContent: "center", borderWidth: 1, borderColor: theme.panelBorder,
  },
  rowText: { flex: 1 },
  rowTitle: { color: theme.bone, fontFamily: fonts.bodySemi, fontSize: 13 },
  rowBy: { color: theme.dim, fontFamily: fonts.body },
  rowRole: { color: theme.dim, fontFamily: fonts.body, fontSize: 11 },
  footer: { color: theme.dim, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, marginTop: 14 },
});
