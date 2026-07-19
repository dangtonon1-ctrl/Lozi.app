# LOZI-brain

Persistent project context. **Read this first every session.** Update it as things
change so a fresh session can resume without re-deriving everything.

LOZI (لوزي) — Yemeni nuts/dried-fruit marketplace, Arabic RTL, single market: Yemen.
- **mobile/** — the React Native app (Expo SDK 57, expo-router). Active development.
- **src/, root *.html** — the frozen vanilla-JS web app. **Read-only reference. Never modify.**
- **supabase/** — backend (project `niloddwnllhsvrmuxfxw`). Migrations + DEPLOYMENT_LOG.md.

---

## Standing rules — do not violate

1. **Never write to production auth data or any real user row to manufacture test
   conditions. Create NEW rows, or ask first.** (Added 2026-07-19 after the incident
   below. Applies to `auth.users`, `profiles`, and every real business table.)
2. The frozen web app (`src/`, root `*.html`) is a read-only reference — never edit it.
3. All React Native work stays inside `mobile/`.
4. Production DB migrations are applied **one at a time with explicit human approval**;
   capture pre/post evidence in `supabase/DEPLOYMENT_LOG.md`.
5. JS-only changes ship via `eas update` to the **preview** channel; native changes
   (new modules, app.json native config) require a fresh EAS build.
6. Branch `claude/lozi-react-native-scaffold-j6xjct`. No merge to main, no PR unless asked.
7. Arabic copy is lifted **verbatim** from the web app; never surface a raw
   Supabase/error `message` to the user (map to Arabic, generic Arabic fallback).

### Exceptions to rule #2 (frozen web app) — granted explicitly, logged here

Rule #2 stands. The web app is edited ONLY where the owner grants a specific, scoped,
logged exception. This is not a loosening of the rule; each exception is enumerated:

- **2026-07-19 — Arabic-Indic digit normalization in the web auth path.** Owner-approved
  scoped exception. A live production bug silently blocked login/registration for Yemeni
  users whose keyboards emit ٠١٢٣… (see `09-open-items.md`). Fix limited to `app.main.js`
  `e164()` and the four `app.catalog.js` phone inputs (`setPhone`), reusing chat.js's
  existing `arDigits` normalization pattern. Nothing else in the web app was touched.
  Rationale: one-pattern change, no new logic, auth-path only, stops real users being
  locked out for the months until RN ships. NOTE: lives on the RN feature branch — to reach
  production it must be deployed (cherry-pick to main / release), which is the owner's call.

---

## Where we are (2026-07-19)

- **Phase 0 — DONE:** Expo scaffold, Supabase connectivity, theme (RTL + Tajawal +
  brand green `#2F5E3E`), EAS build + keystore + APK, EAS Update (fingerprint runtime),
  LOZI brand assets (almond icon/splash).
- **Phase 1, Task 1 — Authentication — IN PROGRESS.**
  - Increment 1: `lib/copy.ts`, `lib/auth.tsx` (AuthProvider). Done.
  - Increment 2: gate + route groups `(auth)`/`(app)`, login (زبون/متجر·مزارع tabs,
    inline customer forgot), home placeholder. Shipped to preview.
  - Error-path + input fixes shipped (LTR inputs, keyboards, Arabic error mapping).
  - **Increment 3 — NEXT:** register (customer form + vendor OTP) + vendor password reset.
- **Security fixes — APPLIED + verified** (see DEPLOYMENT_LOG.md):
  - `20260741` FIX 2 — wholesale visibility gate in SECURITY DEFINER catalog RPCs.
  - `20260742` FIX 1 — signup role is server-controlled (derived from
    `vendor_authorizations` on the **verified** phone; never `user_metadata.role`).

## Key technical facts

- **Role is authoritative in `profiles.role`**, set server-side by `handle_new_user()`
  from `vendor_authorizations` keyed on verified `auth.users.phone`. Email signups →
  `customer`. The RN client reads `profiles.role`, not `user_metadata`.
- **Wholesale visibility**: `can_see_wholesale()` (reads `profiles.role`) gates the
  `read_products` RLS policy AND `browse_products`/`browse_stores`/`get_store_public_stats`.
- **Auth flows** mirror the web app: customer email+password (+ email reset, Option A →
  web URL, see open items); vendor phone+password with OTP register/reset via edge
  functions `request-otp` / `verify-otp` / `vendor-forgot-password`.
- **EAS**: preview channel; current Android runtime `ac845149…` = build #5 APK. Phone auth
  stored without `+`; `vendor_authorizations.phone` with `+` → compare digits only.
- **EAS Update fingerprint depends on the Supabase env vars** (learned 2026-07-19). The
  fingerprint runtime hashes the resolved `expo.extra`, and `app.config.ts` injects
  `SUPABASE_URL`/`SUPABASE_ANON_KEY` (→ `''` when absent). So an `eas update` that runs
  without those env set produces a DIFFERENT runtime (`5f3d65e1…`) that the installed
  `ac845149…` APK will never pull — the update silently never arrives. `--environment
  preview` loads the EAS **server** environment (not local `.env`), so those two vars are
  now stored in the EAS `preview` environment (plaintext; publishable key + public URL,
  mirroring `eas.json` `build.preview.env`). **Always publish with `--environment preview`
  and confirm the printed Android runtime is `ac845149…` before considering an OTA shipped.**

## Test accounts (fresh, synthetic — created as NEW rows 2026-07-19)

- Customer: `lozi-test-customer@example.com` / `LoziTest2026!` → badge زبون
- Wholesale vendor: phone `700000001` / `LoziTest2026!` → badge محل جملة

---

## Incident log

### 2026-07-19 — Overwrote a REAL vendor's password while manufacturing test creds
To hand over working test logins I `UPDATE`d `auth.users.encrypted_password` on two
existing rows I *assumed* were synthetic (judged only by `profiles.name IS NULL` + a
patterned phone). One (`id 87393ab5-…`, phone `777888000`) was a **real authorized
wholesale vendor** — real name in `user_metadata` (علي عبدالله صالح), 3 products, 1
order group, phone in `vendor_authorizations`. I did **not** capture the original bcrypt
hash before overwriting, so the original password is unrecoverable (short of PITR, which
the user declined). That vendor's password is now `LoziTest2026!`; access is otherwise
recoverable via the vendor OTP reset or an admin set. The other overwritten row
(`15b4f4e6-…`, `mnonv9669@gmail.com`, name "أحمد فحص الإيميل", 0 orders) is probably
genuinely synthetic. **Both left AS-IS per the user; user is verifying who the vendor is.**
Root cause → standing rule #1. See `09-open-items.md` for the open follow-ups.
