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

### Planned "native batch" build (do all native deps at once)

We add native modules in ONE build, not one APK per dependency. The batch:
- `react-native-svg` — render the web SVG icons as real vector components.
- `expo-linear-gradient` — real gradient fills.
- whatever **GPS / location** needs in Phase 1 (e.g. `expo-location`).
- **`app.json` `android.softwareKeyboardLayoutMode: "resize"`** — perfects Android
  keyboard avoidance (the auth screens already handle it JS-side; this native flag makes
  the window itself resize). NOTE: it's an `app.json`/native-config change, so it changes
  the EAS fingerprint — it MUST land in a build, not an `eas update` (adding it to
  `app.json` before an OTA would drift the runtime off `ac845149…` and the OTA would never
  reach build #5). Deferred here for exactly that reason.
- **Android monochrome / themed icon** (`android.adaptiveIcon.monochromeImage`) — for the
  Android 13+ themed-icon treatment.
- **`react-native-keyboard-controller`** (optional) — smoother keyboard handling than the
  built-in `KeyboardAvoidingView`; only if the JS approach proves insufficient on device.
- (append any other native module that comes up before the batch ships).

**Follow-up when the batch ships (do not forget):** the rasterized PNG role/brand icons
are a TEMPORARY stand-in — replace them with real `react-native-svg` components built
from the web's SVG source, and swap solid role-circle fills for `expo-linear-gradient`.
The PNGs are not a solution; they exist only to keep this JS-only/OTA until the batch.

## Open gaps

### Auth — login / register
- [ ] **Role picker circle fills**: web uses linear gradients; RN renders solid colors
      (color identity preserved) until `expo-linear-gradient` lands in a build.
- [ ] **Role/brand iconography**: pending the icon-rendering decision (rasterized PNG of
      the web SVGs vs. a build with `react-native-svg`).
- [ ] Transitions between auth steps are default stack pushes; revisit for polish.
- [ ] **Terms & conditions modal**: the web's الشروط والأحكام link opens a terms modal
      (`openTerms`). RN has no terms screen yet, so in the vendor register the words are
      styled as a link but are non-actionable. Wire a terms screen/modal in the polish pass.
- [x] **Vendor OTP registration** built (increment 3b): role → 4-part ID name + phone
      (+967 chip) + terms → `request-otp` → 6-digit code → `verify-otp` → set password
      (`vendor-forgot-password`) → auto sign-in (name persisted via `updateUser`, mirroring
      web `onVendorSignIn`). Blocked states (`not_authorized` / `rate_limited`) show the
      WhatsApp support button (`wa.me/967777184208`, the web `support_wa` default).
- **[Deliberate divergence] Yemen-only notice removed from the register role picker.**
      The web still shows the "🇾🇪 التسجيل متاح حالياً في اليمن فقط" banner on the role step;
      the RN app intentionally omits it (owner decision 2026-07-19). This is a chosen
      divergence, not an oversight — do not "restore for parity." The `copy.yemenOnly` string
      is kept (still mirrors the web) but is now unused in the app.
- [x] **Keyboard avoidance on auth screens** (fixed 2026-07-19, JS-only). All auth screens
      (login, register, vendor OTP, password reset) now wrap content in
      `components/KeyboardAwareScreen` (`KeyboardAvoidingView` padding on iOS + `ScrollView`
      with `keyboardShouldPersistTaps:'handled'`, `keyboardDismissMode:'on-drag'`, focused-input
      auto-scroll) and shrink/hide the brand mark while the keyboard is up (`useKeyboardVisible`
      via `Keyboard` listeners). The Android native `softwareKeyboardLayoutMode:'resize'` flag is
      deferred to the native batch above (fingerprint reasons).
- (add more as the auth screens are built)
