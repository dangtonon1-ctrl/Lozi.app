-- ============================================================================
-- Lozi — Limited-offer countdown fields + per-product sold counters
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-07.
--
-- 1. products.limited_offer_enabled / limited_offer_ends_at:
--    a vendor (or admin, for Savings items) can attach a countdown deadline
--    to a product. The client shows a live "عرض محدود" badge until the
--    timestamp passes; nothing else changes at expiry (pricing untouched).
--    timestamptz is an absolute instant, so countdowns are correct in every
--    timezone (Yemen time included) with no client-side offset math.
--
-- 2. product_sold_counts view: read-only per-PRODUCT sales counts derived
--    from completed (delivered) orders' line items. This intentionally
--    reuses the same source of truth as the commission system (orders that
--    reached 'delivered') instead of inventing a new counter — the
--    profiles.*_cumulative_sales commission counters are per-VENDOR, so a
--    per-product figure must be derived from order lines.
--    "sold_total" counts completed orders containing the product (an order
--    line = one sale), which stays correct even for fractional by-amount
--    quantities. sold_24h / sold_7d power the "الأكثر مبيعاً" ranking.
-- ============================================================================

alter table public.products
  add column if not exists limited_offer_enabled boolean not null default false,
  add column if not exists limited_offer_ends_at timestamptz;

-- View runs with owner rights (postgres), so anonymous shoppers can read the
-- aggregate counts without opening up the orders table itself.
create or replace view public.product_sold_counts as
select
  (it->>'p')::uuid                                            as product_id,
  count(*)                                                    as sold_total,
  count(*) filter (where o.created_at >= now() - interval '24 hours') as sold_24h,
  count(*) filter (where o.created_at >= now() - interval '7 days')   as sold_7d
from public.orders o
cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
where o.status = 'delivered'
  and (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
group by 1;

grant select on public.product_sold_counts to anon, authenticated;
