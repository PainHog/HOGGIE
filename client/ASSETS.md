# Client assets — licenses & attribution

Every asset the visual client ships is **free and bundled locally** (no runtime downloads, no
API keys, $0). Each is one of exactly three license categories, as required:

| Asset | Source | License | Attribution required? |
|---|---|---|---|
| UI icons / silhouettes (25) | [game-icons.net](https://game-icons.net/) via the `@iconify-json/game-icons` npm package | **CC BY 3.0** | **Yes** — see Credits screen |
| Display font — Grenze Gotisch | Google Fonts (`@expo-google-fonts/grenze-gotisch`) | **OFL 1.1** | No (bundled `LICENSE_FONT`) |
| Body font — Spectral | Google Fonts (`@expo-google-fonts/spectral`) | **OFL 1.1** | No (bundled `LICENSE_FONT`) |

There is **nothing else** — no paid assets, no unlicensed art. UI chrome (panels, bars, the room
scene, minimap) is drawn procedurally with React Native + `react-native-svg`, so it needs no
third-party art. (Kenney CC0 tiles/frames are an approved option for later; the slice did not need
them, so none are bundled yet — adding them changes nothing here since CC0 requires no attribution.)

## game-icons.net — CC BY 3.0 (attribution)

CC BY 3.0 **requires** crediting the original artist. The client satisfies this with an in-app
**Credits screen** (reachable from the character-select screen and the in-game menu) that lists,
for every icon actually used, its title, its artist, and a link to the icon's canonical
game-icons.net page — plus the license.

- The icon **geometry** is copied out of the `@iconify-json/game-icons` package into
  `src/art/icons.generated.ts` (so the art is bundled in-repo, not a runtime dependency).
- The **attribution list** is generated from the exact set of icons used, into
  `src/art/credits.generated.ts`, and rendered verbatim by `src/screens/CreditsScreen.tsx`.
- Each artist was **verified** against the icon's own game-icons.net page (not guessed).

Distinct artists whose work is bundled: **Delapouite, Lorc, sbed, Skoll, Zeromancer** — all under
CC BY 3.0.

## Regenerating

Both generated files come from one script (safe to re-run; edit the `USED` map to change the set):

```bash
cd client
npm run gen:icons     # -> src/art/icons.generated.ts + src/art/credits.generated.ts
```

If you add or swap an icon, re-verify its artist on game-icons.net and update the `USED` map in
`scripts/gen-icons.mjs` before regenerating, so the Credits screen stays accurate.
