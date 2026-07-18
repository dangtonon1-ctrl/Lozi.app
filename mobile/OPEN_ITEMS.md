# LOZI mobile — open items

Deferred work surfaced during Phase 0/1. Each item says why it's deferred and what
"done" looks like. Not a backlog for everything — only things we consciously chose to
postpone so they don't get lost.

## Before launch

- [ ] **`lozi://reset` deep link for in-app customer password recovery.**
  Phase 1 auth (Task 1) ships with customer password reset pointing at the frozen web
  app's URL (Option A). To recover fully in-app, add `lozi://reset` (and any
  `exp://…/--/reset` dev variant) to the Supabase dashboard's **Auth → URL Configuration →
  Redirect URLs**, then handle the deep link in the app (expo-linking) to route into the
  reset screen on `PASSWORD_RECOVERY`. Dashboard setting + client wiring only — no schema
  change. Deferred so customer reset keeps working via web in the meantime.

## Admin panel (backend)

- [ ] **Role recovery for a mis-onboarded authorized vendor.**
  Surfaced by migration `20260742_role_server_controlled_signup` (FIX 1). A vendor whose
  number is in `vendor_authorizations` but who signed up through the normal **email** flow
  has no verified `auth.users.phone`, so they correctly land as `customer`. `handle_new_user`
  is INSERT-only and `verify-otp` never writes `profiles.role` for an existing user, so even
  if they later verify their phone **no automated path grants the vendor role** — they are
  stuck as `customer`. Recovery today is a manual `profiles.role` update by an admin
  (`profiles_admin_update`). Admin panel should expose a "set/correct role" action for this.
  Intentionally not built now; the email-signup→`customer` outcome itself is the intended
  security invariant, not a bug.
