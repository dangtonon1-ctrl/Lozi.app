-- ════════════════════════════════════════════════════════════════════════════
-- Realtime Phase 1 (orders) — Step (i): server enablement ONLY.
--
-- Adds the two order tables to the `supabase_realtime` publication so Postgres
-- emits change events for them. This is the ONLY server-side change the live
-- order-tracking feature needs — no schema change, no REPLICA IDENTITY change,
-- no new RLS policies, no new grants.
--
-- Why no REPLICA IDENTITY change: the client subscribes to INSERT + UPDATE only
-- (never '*') and uses re-fetch-on-event (it never reads payload.old). On
-- UPDATE the NEW record carries customer_id / seller_id, so the existing RLS
-- SELECT policies (orders_customer_read, orders_seller_read, osg_customer_read,
-- osg_seller_read, *_admin) authorize each subscriber correctly under the
-- default (primary-key) replica identity. DELETE is intentionally excluded
-- because Realtime does NOT apply RLS to DELETE — it broadcasts the deleted PK
-- to every subscriber. Deletions here are the actor's own local action
-- (customer cancelling an own pending order), so no live push is required.
--
-- Realtime evaluates RLS against the BASE table, which requires `authenticated`
-- to hold a direct SELECT grant — already present on both tables (verified).
--
-- Defense-in-depth (consistent with 20260725_close_demo_insert_anon_hole):
-- revoke the API-reachable DML grants on order_seller_groups from `anon`. RLS
-- already denies anon (no anon policy exists on the table), and anon never
-- subscribes to these tables, so this removes latent attack surface without
-- changing any legitimate read/write path. `orders` already had its anon
-- SELECT/INSERT revoked in 20260725; this brings order_seller_groups in line.
--
-- Backward-compatible. Idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Add tables to the Realtime publication (guarded — ALTER PUBLICATION ... ADD
--    TABLE errors if the table is already a member, so only add when missing).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_seller_groups'
  ) then
    execute 'alter publication supabase_realtime add table public.order_seller_groups';
  end if;
end $$;

-- 2. Defense-in-depth: strip anon's latent DML grants on order_seller_groups.
--    REVOKE is idempotent (no error when the privilege is absent). `authenticated`
--    grants are untouched, so customer/seller Realtime authorization is unaffected.
revoke select, insert, update, delete on public.order_seller_groups from anon;
