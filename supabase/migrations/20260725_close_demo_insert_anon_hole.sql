-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening — close the demo_insert anon-INSERT hole on public.orders.
--
-- `demo_insert` was a leftover always-true permissive INSERT policy (WITH CHECK
-- true, no role → PUBLIC, incl. anon) — the INSERT-side twin of the `demo_read`
-- policy dropped in 20260706_orders_read_isolation. Checkout is always
-- authenticated (the client sets customer_id = auth.uid() and refuses checkout
-- without a session), so no legitimate flow relies on anon INSERT; the policy is
-- pure attack surface. The legitimate customer path — orders_insert (to
-- authenticated, WITH CHECK auth.uid() = customer_id) — is independent and stays
-- intact, AND-ed with the restrictive orders_block_suspended_seller.
--
-- Applied in strict dependency order; each statement is independently reversible
-- (see supabase/rollback/20260725_close_demo_insert_anon_hole.sql):
--   (a) drop the permissive policy   → anon has no satisfiable INSERT policy left
--   (b) revoke anon INSERT grant      → defense-in-depth (RLS already denies)
--   ( ) revoke anon SELECT grant      → latent grant; no SELECT policy applied to anon
--   (c) revoke anon EXECUTE on the two SECURITY DEFINER helpers, matching is_suspended:
--       - is_seller_on_order          : only used by orders_seller_read (to authenticated)
--       - order_has_suspended_seller  : only used by the restrictive INSERT block; anon
--         can no longer insert, so it never needs to evaluate it — hence AFTER (a).
--       Supabase's schema default-privilege granted EXECUTE directly to `anon`, which
--       the Step-3 `revoke … from public` did NOT strip, so we revoke from `anon`.
--
-- Verified on a local Postgres replica (schema pulled from prod) as BOTH the anon
-- and authenticated roles: authenticated customer insert still succeeds with the
-- delivery-fee, group-sync, stock and commission machinery intact; anon insert and
-- select are rejected; suspension block and ownership check still enforced;
-- forward/rollback proven reversible. Applied to project niloddwnllhsvrmuxfxw.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists demo_insert on public.orders;                                     -- (a)
revoke insert on table public.orders from anon;                                         -- (b)
revoke select on table public.orders from anon;                                         -- latent SELECT grant
revoke execute on function public.is_seller_on_order(uuid) from anon;                    -- (c)
revoke execute on function public.order_has_suspended_seller(jsonb, uuid) from anon;     -- (c)
