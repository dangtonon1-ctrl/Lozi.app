# 10 — Web parity gaps (running list)

We are NOT chasing full visual parity screen-by-screen right now. This is a running
list of gaps between the RN app and the frozen web reference; we'll close them in **one
dedicated polish pass after the whole auth flow is done.** Add to it as we build.

## Guiding principle

**Identical brand identity — colors, type, iconography — but native mobile behavior.**
Touch-sized targets, real transitions, pull-to-refresh, proper keyboard handling. An app
that feels like a wrapped website reads as low quality. So: match the web's look (brand),
but do not imitate web interaction patterns where a native one is expected.

## Native-module watch (why some parity is deferred)

Pixel-exact rendering of some web pieces needs native modules not in the current binary
(build #5), which would break the JS-only / `eas update` cadence and require a new build:
- **`react-native-svg`** — to render the web's exact SVG icon glyphs.
- **`expo-linear-gradient`** — to render the web's gradient fills (role circles, etc.).
Until we choose to build, these render via JS-only approximations (rasterized PNG icons,
solid colors) that keep the brand identity.

## Open gaps

### Auth — login / register
- [ ] **Role picker circle fills**: web uses linear gradients; RN renders solid colors
      (color identity preserved) until `expo-linear-gradient` lands in a build.
- [ ] **Role/brand iconography**: pending the icon-rendering decision (rasterized PNG of
      the web SVGs vs. a build with `react-native-svg`).
- [ ] Transitions between auth steps are default stack pushes; revisit for polish.
- (add more as the auth screens are built)
