# 09 — Open items

Deferred work + follow-ups, consolidated here (canonical). Each says why it's
deferred and what "done" looks like.

## Incident follow-ups (2026-07-19) — highest priority

- [ ] **Real vendor whose password I overwrote.** `auth.users` id
      `87393ab5-cfda-4158-9b49-a4ce2840aa10`, phone `777888000`, name
      علي عبدالله صالح, role wholesale, 3 products + 1 order group, phone in
      `vendor_authorizations`. Password was overwritten to `LoziTest2026!`; original
      bcrypt hash NOT captured (unrecoverable without PITR, which the user declined).
      **Left AS-IS.** User is verifying whether it's their own test account. Decide:
      leave / set a known password to hand back to the vendor / notify them to OTP-reset.
- [ ] **Second overwritten row (likely synthetic):** `15b4f4e6-…`,
      `mnonv9669@gmail.com`, name "أحمد فحص الإيميل", 0 orders. Password now
      `LoziTest2026!`. Left AS-IS pending the user's call.
- Note: fresh, purpose-built test accounts now exist (see LOZI-brain/README.md), so the
  two overwritten rows no longer need to be used for testing.

## Web app bugs (frozen reference — LOG ONLY, do not fix here)

- [ ] **Arabic-Indic digits break phone auth on the web app.** `app.main.js`'s `e164()`
      does `String(p).replace(/[^0-9]/g,'')` with no digit normalization, and the
      `app.catalog.js` phone input doesn't normalize either. A Yemeni user who types their
      phone in ٠١٢٣٤٥٦٧٨٩ gets every digit stripped → login/register fails silently. The
      web already has normalizers (`arDigits` in chat.js, `weightKg` in app.shop.js) but
      never applied them to the auth path. **Fixed in the RN app** via
      `mobile/lib/normalizeDigits.ts` (used in `e164`, `validate.phone`, and phone inputs).
      Left unfixed on the frozen web app by instruction; owner should port the fix there.

## Before launch

- [ ] **`lozi://reset` deep link for in-app customer password recovery.** Task 1 ships
      customer reset pointing at the frozen web app's URL (Option A). For full in-app
      recovery: add `lozi://reset` (+ an `exp://…/--/reset` dev variant) to Supabase
      Auth → URL Configuration → Redirect URLs, then handle the deep link (expo-linking)
      to route into the reset screen on `PASSWORD_RECOVERY`. Dashboard setting + client
      wiring; no schema change.

## Admin panel (backend)

- [ ] **Role recovery for a mis-onboarded authorized vendor.** From migration
      `20260742` (FIX 1): a vendor whose number is in `vendor_authorizations` but who
      signed up via the **email** flow has no verified `auth.users.phone`, so they
      correctly land as `customer`, and no automated path grants the role later
      (INSERT-only trigger; `verify-otp` doesn't write `profiles.role` for an existing
      user). Recovery today is a manual admin `profiles.role` update
      (`profiles_admin_update`). Admin panel should expose a "set/correct role" action.
      The email-signup→`customer` outcome is the intended invariant, not a bug.
