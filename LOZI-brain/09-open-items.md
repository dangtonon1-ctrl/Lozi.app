# 09 — Open items

Deferred work + follow-ups, consolidated here (canonical). Each says why it's
deferred and what "done" looks like.

## Incident follow-ups (2026-07-19) — highest priority

- [x] **RESOLVED — `777888000` is a test account, not a real vendor** (owner-confirmed
      2026-07-19). `auth.users` id `87393ab5-cfda-4158-9b49-a4ce2840aa10`, name
      علي عبدالله صالح, role wholesale. The session-1 password overwrite (to `LoziTest2026!`)
      therefore harmed no real user, and this number is **safe to use for testing**. The
      standing rule #1 (never write real auth/user rows to manufacture test conditions)
      still stands regardless — the rule is about the *risk taken*, not this outcome.
- [ ] **Second overwritten row (likely synthetic):** `15b4f4e6-…`,
      `mnonv9669@gmail.com`, name "أحمد فحص الإيميل", 0 orders. Password now
      `LoziTest2026!`. Left AS-IS pending the user's call.
- Note: fresh, purpose-built test accounts now exist (see LOZI-brain/README.md), so the
  two overwritten rows no longer need to be used for testing.

## Security — OTP bypass backdoor in production edge functions

- [ ] **`TEST_BYPASS_CODE` backdoor path is deployed in production.** Confirmed 2026-07-19
      via MCP `get_edge_function`: `verify-otp` (v8, ACTIVE) contains
      `const bypass = Deno.env.get("TEST_BYPASS_CODE") || ""; if (bypass.length>0 &&
      String(code)===bypass) approved = true;` — i.e. **if that secret is set, its value is
      a master OTP** that passes verification for any phone with no SMS. `request-otp` also
      keys its whole test mode off the same var (skips the 24h rate limit, tolerates Twilio
      failures). Impact **if set**: anyone who knows the value can (a) `purpose:reset` →
      obtain a `setup_token` for **any existing account** → `vendor-forgot-password` → take
      it over; (b) `purpose:register` → claim **any phone that's in `vendor_authorizations`**
      without SMS. The SMS is the only possession factor, so this is a full auth bypass for
      those accounts. (Note: it still can't touch a phone that is neither authorized nor
      already an account.)
    - **SET-state / value NOT verifiable from the agent environment**: no MCP secrets
      endpoint; no Supabase CLI or Management-API PAT on the box; Supabase never returns a
      secret's plaintext (only name + SHA-256 digest via the Management API); and the agent
      proxy denies CONNECT to `niloddwnllhsvrmuxfxw.supabase.co`, so the endpoint can't be
      probed either. **Owner must check**: Dashboard → Project Settings → Edge Functions →
      Secrets (shows the name if set), or `supabase secrets list --project-ref
      niloddwnllhsvrmuxfxw`.
    - **If set now (owner action; nothing changed by the agent):** `supabase secrets unset
      TEST_BYPASS_CODE` (or delete it in the dashboard). Current set-state unconfirmed in
      the 2026-07-19 thread (owner's dashboard result came through as an unfilled
      placeholder) — but per owner decision this is treated as a hard blocker regardless.
- [ ] **PRE-LAUNCH BLOCKER (owner-designated 2026-07-19): remove the `TEST_BYPASS_CODE`
      code path entirely from `verify-otp` and `request-otp`.** Not a nice-to-have. Unsetting
      the env var is not sufficient — while the branch exists, a single env var can re-arm a
      full auth bypass. "Done" = the `bypass`/`testMode` branches are deleted from both
      functions (OTP verification always goes through Twilio), redeployed, and the deploy is
      logged in `supabase/DEPLOYMENT_LOG.md`. Must land before GA. If a test path is still
      needed pre-GA, gate it on a non-production project ref rather than an env flag.

## Web app bugs (frozen reference — LOG ONLY, do not fix here)

- [ ] **Arabic-Indic digits break phone auth on the web app.** `app.main.js`'s `e164()`
      does `String(p).replace(/[^0-9]/g,'')` with no digit normalization, and the
      `app.catalog.js` phone input doesn't normalize either. A Yemeni user who types their
      phone in ٠١٢٣٤٥٦٧٨٩ gets every digit stripped → login/register fails silently. The
      web already has normalizers (`arDigits` in chat.js, `weightKg` in app.shop.js) but
      never applied them to the auth path. **Fixed in the RN app** via
      `mobile/lib/normalizeDigits.ts` (used in `e164`, `validate.phone`, and phone inputs).
      Left unfixed on the frozen web app by instruction; owner should port the fix there.

## Testing / verification

- [ ] **Vendor OTP end-to-end test (register 3b + reset 3c) — PENDING a clean SIM.** The RN
      vendor registration and password-reset flows shipped and typecheck/build clean, but the
      full OTP round-trip (`request-otp` → real SMS → `verify-otp` → set password via
      `vendor-forgot-password` → auto sign-in) has **not** been exercised on a device.
      Blocked: no unused phone number available to the owner right now. The one candidate given
      (`+967777184208`) turned out to be a real, active **wholesale** account
      (أحمد محمد يحيى القعاري, user `8ddffebf-…`) — **not usable**, left untouched. Owner is
      testing the vendor UI **up to the send-code step only** for now; do the full round when a
      clean SIM exists. When that happens: create a NEW `vendor_authorizations` row
      (`status='active'`, `role='farmer'`) for the genuinely-unused number only — never reuse
      or overwrite a real row (standing rule #1); re-verify the number is absent from
      `auth.users` / `vendor_authorizations` / `farmers` / `retail_stores` / `wholesale_stores`
      first (phones are stored without `+` in `auth.users`, with `+967` in
      `vendor_authorizations`).

## Before launch

- [ ] **`lozi://reset` deep link for in-app customer password recovery.** Task 1 ships
      customer reset pointing at the frozen web app's URL (Option A). For full in-app
      recovery: add `lozi://reset` (+ an `exp://…/--/reset` dev variant) to Supabase
      Auth → URL Configuration → Redirect URLs, then handle the deep link (expo-linking)
      to route into the reset screen on `PASSWORD_RECOVERY`. Dashboard setting + client
      wiring; no schema change.
- [ ] **LAUNCH BLOCKER: purge test products from the production DB before Google Play
      release.** The live catalog is currently almost all test data («تجربة…», «Test…»,
      «تعديل السعر», the `mine-retail`/`Test` stores, etc. — see the 2026-07-19 retail
      audit). These must NOT ship to real users. **Do NOT delete now — we still need them
      for RN testing.** Pre-release: identify test rows (test stores/vendors + obvious test
      names) and remove them (or hide via `status`), with before/after evidence in
      `DEPLOYMENT_LOG.md`. Coordinate with the test-account cleanup so real seed data (if any)
      is preserved.

## Admin panel (backend)

- [ ] **Role recovery for a mis-onboarded authorized vendor.** From migration
      `20260742` (FIX 1): a vendor whose number is in `vendor_authorizations` but who
      signed up via the **email** flow has no verified `auth.users.phone`, so they
      correctly land as `customer`, and no automated path grants the role later
      (INSERT-only trigger; `verify-otp` doesn't write `profiles.role` for an existing
      user). Recovery today is a manual admin `profiles.role` update
      (`profiles_admin_update`). Admin panel should expose a "set/correct role" action.
      The email-signup→`customer` outcome is the intended invariant, not a bug.

## Vendor app / data quality (later task)

- [ ] **Structured weight selector in the vendor product form (the real fix for weight).**
      `data.weight` is free text and inconsistent across products («1» / «1 كيلو» / «1 كجم» /
      «500» / «عرض مشكّل»); both the web and RN show it verbatim. The structured `weight_grams`
      column is reliable (19/20 populated, all 1000), so the RN catalog renders a unified value
      from it (1000→«1 كجم», 500→«500 جم») and only falls back to the free text when
      `weight_grams` is null. The durable fix is the **vendor app entering weight via a
      structured selector** (grams/kg), not free text — deferred to the vendor-app work.
