-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 2c — Phase B fix: orders_seller_facing fails OPEN on
-- unresolvable items (deleted product / non-uuid RFQ `p`) instead of hiding them.
--
-- 20260730 filtered `items` to the caller's own lines, falling back to the order's
-- primary `seller_vendor_id` when a line's product could not be resolved. On a
-- multi-seller order that mis-handles a deleted-product edge: if a SECONDARY
-- seller's product row is deleted, their line resolves to NULL → falls back to the
-- primary → the line VANISHES from its true owner (who must still fulfil it) and
-- LEAKS onto the primary. Verified live (rolled-back): deleting seller 9d52fae2's
-- product on 983057 gave 9d52 → 0 items, primary 66563 → 6 items.
--
-- Fix: change only the fallback in the `items` filter's coalesce from
-- `o.seller_vendor_id` to `auth.uid()`. The predicate
-- `coalesce(resolved_vendor, auth.uid()) = auth.uid()` now:
--   • resolvable & mine        → true  (keep, isolated as before)
--   • resolvable & another's   → false (drop, isolated as before)
--   • UNRESOLVABLE (NULL)      → true  (keep) — shown to EVERY seller on the order,
--     so an orphaned/RFQ line never disappears from the seller who must fulfil it.
-- Admin (is_admin()) and NULL items still pass through unchanged.
--
-- Single-seller byte-identical: every line either resolves to the one seller
-- (= auth.uid()) or is unresolvable (kept either way — the old primary-fallback
-- also equalled auth.uid() there), so `items` is unchanged. This is an in-place
-- CREATE OR REPLACE (items expression only); grants preserved.
--
-- Trade-off (accepted): an unresolvable line is over-shown to the order's other
-- sellers — but only orphaned/RFQ lines, only on multi-seller orders. The precise
-- alternative (snapshot vendor_id onto each item at order creation) is logged as a
-- DEFERRED hardening item — it touches the order-creation money-chain trigger and
-- cannot reliably backfill items whose product is already deleted.
--
-- Pre-image: supabase/rollback/20260731_orders_seller_facing_failopen_items_preimage.sql
-- Idempotent (create or replace). No data modified. Target: niloddwnllhsvrmuxfxw.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.orders_seller_facing
with (security_invoker = on) as
select
    o.id,
    o.created_at,
    o.order_no,
    o.vendor,
    o.status,
    o.pay,
    o.total,
    case
        when is_admin() then o.items
        when o.items is null then o.items
        else coalesce((
            select jsonb_agg(elem.it order by elem.ord)
            from jsonb_array_elements(o.items) with ordinality as elem(it, ord)
            where coalesce(
                    (select p.vendor_id from public.products p
                      where p.id = case
                          when (elem.it->>'p') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then (elem.it->>'p')::uuid
                          else null
                        end),
                    auth.uid()
                  ) = auth.uid()
        ), '[]'::jsonb)
    end as items,
    o.customer,
    o.seller_vendor_id,
    o.customer_id,
    o.reject_reason,
    o.pay_receipt,
    o.pay_status,
    o.delivery_fee,
    o.segment,
    o.goods_subtotal,
    o.commission_rate_applied,
    o.commission_amount,
    o.cumulative_before,
    o.commission_state,
    o.reversed_amount,
    case
        when o.status = 'rejected' then 'rejected'
        when o.status = 'cancelled' then 'cancelled'
        when g.seller_decision = 'rejected' then 'rejected'
        when o.status = 'delivered' or g.fulfillment_status = 'delivered_to_customer' then 'delivered'
        when g.seller_payout_status in ('paid_cash', 'paid_transfer') then 'seller_paid'
        when g.fulfillment_status in ('inspected_and_received', 'out_for_delivery') then 'at_hub'
        when g.fulfillment_status = 'pending_hub_delivery' then 'to_hub'
        when o.status = 'preparing' then 'preparing'
        when g.seller_decision = 'accepted'
             and g.fulfillment_status = 'paid_by_customer'
             and public.order_status_rank(o.status) = 0 then 'preparing'
        else 'new'
    end as internal_status,
    g.seller_decision,
    g.decline_reason,
    g.refund_owed_yer
from orders o
left join lateral (
    select g.fulfillment_status,
           g.seller_payout_status,
           g.seller_decision,
           g.decline_reason,
           g.refund_owed_yer
    from order_seller_groups g
    where g.order_id = o.id
      and (g.seller_id = auth.uid() or is_admin())
    order by (g.seller_id = auth.uid()) desc nulls last, g.created_at
    limit 1
) g on true
where exists (
    select 1
    from order_seller_groups g2
    where g2.order_id = o.id
      and g2.seller_id = auth.uid()
) or is_admin();
