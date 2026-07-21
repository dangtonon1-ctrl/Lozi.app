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

### Cart / checkout — deferred to the cart task (owner-agreed 2026-07-19)

These were agreed earlier but never written down; recording them here so they aren't
re-litigated. They belong to the **cart task**, not Task 2 (catalog browsing):
- [ ] **Product image gallery / lightbox modal** — the web `LoziCarousel` supports
      full-screen zoom (`ImageLightbox`). RN detail page gets the swipe carousel now; the
      zoom/lightbox modal is deferred.
- [ ] **Product name as a `Pressable` link** — tapping the product name opens the detail
      page (web makes the whole card + name clickable). Wire when the detail route lands.
- [ ] **Thumbnails in the cart** — each cart line shows the product image.
- [ ] **Group cart by store** — cart items grouped per vendor (matches the web's
      per-seller order grouping / `order_seller_groups`).
- [ ] **Deleted / out-of-stock states in the cart** — a line whose product was removed or
      went `stock ≤ 0` after being added must show a clear state (not silently priced/ordered).
- [ ] **Same treatment in «طلباتي» (My Orders)** — thumbnails, per-store grouping, and
      deleted/out-of-stock handling apply to the order history screens too.

### Catalog — tech debt (owner-agreed 2026-07-19)

- [ ] **`loadStores` fetches every store + its offers in one query** (mirrors the web).
      Discounts are then computed client-side from that map (`withDiscount`). Fine at the
      current store count, but it does not scale. Future fix: compute the discount inside the
      `browse_products` RPC (return the effective price + `old`), OR fetch offers only for the
      vendors of the products actually on screen. Do NOT solve now — logged so it isn't lost.
### Home section model — CORRECTED 2026-07-19 (earlier note was wrong on a partial sample)

- **The web home has FOUR section tiles + a gated wholesale tile, not two.** The `cats`
  array is `[savings, retail, raisin, almond]` → RTL-rendered **اللوز / الزبيب / التجزئة /
  التوفير**, plus a separate `showWholesale && …` tile → **سوق الجملة** (when
  `can_see_wholesale`). My increment-4 home wrongly dropped the whole row believing sections
  meant only almond/raisin. **`retail`/التجزئة is the section that holds all 20 products.**
  The home rebuild MUST restore the full row: اللوز / الزبيب / التجزئة / التوفير (+ سوق الجملة).
  Each tile → `go("sections",{section})` except التوفير → the separate Savings screen.
  (Standing rule from this miss: investigate the *complete* web model before dropping any
  element, never a partial sample.)

### Home data-loading — DELIBERATE DIVERGENCE from the web (owner decision 2026-07-19)

- **The web home loads the ENTIRE visible catalog** via a raw `from("products").select("*")`
  into a client `dbProducts` array + realtime, and derives everything client-side (savings =
  `cat==="savings"`, `عروض اليوم` = almond/raisin top-8, `متاجر مميّزة` = products grouped by
  vendor). `browse_products` is used ONLY for the section browse screens.
- **RN does NOT copy this** — weak-network conditions make a full-catalog fetch on every open
  the wrong default. Instead:
  - Home fetches only a **small capped set** for what it renders (rail + featured stores) — not
    the whole catalog.
  - Each **section loads on entry, 24/page via `browse_products`**.
  - **التوفير/savings gets its own query when its tab opens** (not preloaded). browse_products
    excludes savings, so savings needs a dedicated fetch (raw select filtered to
    `category='savings'`, or a savings RPC).
  - **متاجر مميّزة** and **التوفير** therefore need **their own queries** — they can't be
    derived from a preloaded array the way the web does.
  - **`عروض اليوم` rail stays almond/raisin-only** (empty today), exactly like the web.
- **BUT keep realtime** (owner wants live updates): subscribe to `products` `postgres_changes`
  and update whatever is currently on screen; **pause/unsubscribe when the app is backgrounded**
  (`AppState`) to save battery/data. Realtime is independent of the initial-load strategy —
  lazy load + live updates coexist. (Supabase realtime is JS-only websocket; no native module.)

### Bottom tab shell — SHIPPED 2026-07-19

- `app/(app)/(tabs)` Tabs layout: **home / sections / [savings|dashboard] / cart / profile**.
  3rd tab swaps by role (customer → التوفير, seller → الطلبات) via `href:null`. Cart will show
  a `cartCount` badge (cart task). Unimplemented tabs render `ComingSoon` (قريباً); sign-out
  moved to the profile tab. `catalog/[section]` + `product/[id]` are Stack siblings that push
  OVER the tabs.
- [x] **Tab icons** now use **Ionicons** (`@expo/vector-icons`), outline/filled + tinted by
      state. Confirmed OTA-safe: no native module (uses the already-native `expo-font`),
      fingerprint unchanged (`ac845149`), `Ionicons.ttf` ships as a bundled asset.

### Home — REBUILT 2026-07-19 (web-faithful, on the tab shell)

Full web structure, top→bottom: search + bell, تسوّق حسب / الأقسام (4 scrollable section
tiles savings/retail/raisin/almond + gated سوق الجملة is a banner, not a tile), طازج اليوم /
عروض اليوم rail (almond/raisin, empty today), the three banners (الطلب المسبق / أضف منتجك /
سوق الجملة) with web order + gating + subtitles, الأعلى تقييماً / متاجر مميّزة, floating chat
FAB. Lazy/capped fetches (`browseStores` limit 6 + almond/raisin rail), realtime with
background pause (`lib/realtime.ts`), verbatim weight text.

- [ ] **Gradients need a build — NOT OTA-shippable** (confirmed 2026-07-19: installing
      `expo-linear-gradient` changes the fingerprint → new APK). Banner backgrounds use the
      first gradient stop as a solid now (`backgroundColor: colors[0]`); each `Banner` is
      structured so swapping in `<LinearGradient colors={c}>` is a one-line change. Exact
      gradients recorded: rfq `#2F5E3E→#C08A43`, farmer `#8a5a78→#6b3f5a`, wholesale
      `#5e4a30→#42321e`; tile circles rfq… see TILES in home.tsx.
- [ ] **`react-native-svg` needs a build** (same fingerprint proof). Section tiles use the
      **exact web CatGlyph shapes rasterized to PNG** (`cat-almond/raisin/retail/savings.png`)
      — a deliberate, more-faithful choice than Ionicons for the tiles (Ionicons has no
      almond/raisin). Swap to real `react-native-svg` CatGlyph components in the native batch.
- [ ] **Search** is a tap-target styled like the web search bar → `قريباً` (real search =
      later). **Notifications bell**, **الطلب المسبق (RFQ)**, **أضف منتجك**, and the **chat FAB**
      are rendered in place, visually complete, → `قريباً` (features not built in RN yet).
- Weight on the card stays **verbatim free text** — `weight_grams` is a stale backfill (all
  1000, contradicts `"500"`/`"عرض مشكّل"`), NOT wired; real fix = vendor structured selector
  (09-open-items).
