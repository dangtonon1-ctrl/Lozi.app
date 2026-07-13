-- ════════════════════════════════════════════════════════════════════════════
-- Realtime Phase 2 (products / offers / savings) — server enablement ONLY.
--
-- Adds public.products to the `supabase_realtime` publication so Postgres emits
-- change events for it. This ONE table covers all three Phase-2 surfaces: the
-- product feed, the "offers/العروض" flags (products.limited_offer_enabled /
-- limited_offer_ends_at) and the customer "savings/التوفير" section
-- (products.category = 'savings') are all rows of public.products.
-- (savings_products is unused by the client; product_sold_counts is a VIEW over
-- orders and cannot be published — live sold-counts, if pursued, ride the
-- existing orders publication. Neither is touched here.)
--
-- Like the orders enablement (20260726), this is the ENTIRE server requirement:
-- no schema change, no REPLICA IDENTITY change, no new RLS policy, no new grant.
--
-- Why no REPLICA IDENTITY change: the client subscribes to INSERT + UPDATE only
-- (never '*') and RE-FETCHES the product list on each event — it never reads the
-- payload. On INSERT/UPDATE the NEW record carries vendor_id / status, so the
-- existing SELECT policies authorize each subscriber under the default
-- (primary-key) replica identity. DELETE is intentionally excluded because
-- Realtime does NOT apply RLS to DELETE (it would broadcast the deleted PK to
-- every subscriber). Consequence — ACCEPTED by decision: a hard DELETE of a
-- product does not propagate live (it clears on the next natural reload; the
-- price-integrity trigger already blocks ordering a missing product). The
-- common "hide from storefront" action is a soft-hide UPDATE (status='hidden'),
-- which DOES propagate; a soft-delete button rework is a separate future task.
--
-- RLS posture — DECISION "A" (products_select_all USING(true) kept as-is):
-- the two permissive SELECT policies on products OR together —
--   read_products        USING (status = 'available')
--   products_select_all  USING (true)          [PUBLIC]
-- so EVERY product row is SELECT-authorized for every subscriber. This is what
-- makes the soft-hide pattern work over Realtime: the status → 'hidden' UPDATE
-- is delivered, the client re-fetches, rowToProduct sets active=false and the
-- card drops. The flip side — products_select_all also makes hidden rows +
-- all columns anon-readable (already true via REST today, NOT introduced here) —
-- is left UNCHANGED and tracked as a SEPARATE future hardening ticket.
--
-- Realtime evaluates RLS against the BASE table, which requires `authenticated`
-- to hold a direct SELECT grant on products — already present (verified).
--
-- Defense-in-depth (mirrors 20260726 on order_seller_groups): revoke anon's
-- latent WRITE DML on products. anon's SELECT is DELIBERATELY KEPT — visitor
-- browsing stays open (anon must keep reading products). RLS already denies anon
-- writes (own_products / products_*_own require auth.uid() = vendor_id; the admin
-- policies require is_admin()), so this removes latent surface without changing
-- any legitimate read or write path.
--
-- Backward-compatible. Idempotent (safe to re-run). Client stays inert until the
-- Phase-2 (2a) client increment ships.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Add products to the Realtime publication (guarded — ALTER PUBLICATION ...
--    ADD TABLE errors if the table is already a member, so only add when missing).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    execute 'alter publication supabase_realtime add table public.products';
  end if;
end $$;

-- 2. Defense-in-depth: strip anon's latent WRITE DML on products. SELECT is NOT
--    revoked (visitor browsing must keep working). REVOKE is idempotent (no error
--    when the privilege is absent). `authenticated` grants are untouched, so
--    Realtime authorization for signed-in customers/sellers is unaffected.
revoke insert, update, delete on public.products from anon;
