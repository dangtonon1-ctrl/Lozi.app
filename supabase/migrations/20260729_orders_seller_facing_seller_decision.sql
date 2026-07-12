-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 2c — Phase A: orders_seller_facing surfaces the seller's OWN
-- per-group decision (server-side, views-only, backward compatible).
--
-- Step 2b (20260720) added seller_decision (pending|accepted|rejected) + the
-- manual-refund flag to order_seller_groups, but orders_seller_facing.internal_status
-- is still derived only from the ORDER aggregate + the group's fulfillment_status.
-- In a multi-seller order that means a seller who has already accepted or rejected
-- THEIR slice can't see it: while the OTHER sellers are still pending the order
-- stays at 'new' (rank 0), so this seller's card would keep showing 'new' with live
-- accept/reject buttons — their own decision would appear to have been lost.
--
-- This migration augments the (security_invoker) view so the CALLER's own group
-- decision drives internal_status, and exposes decline_reason + refund_owed_yer so
-- the Phase-B seller UI can render a "you declined this slice — X ر owed back"
-- banner. Two additive CASE branches + three additive columns; nothing else moves.
--
-- ── Single-seller byte-identical (each existing column unchanged) ────────────
--   • «own rejected → 'rejected'» is placed AFTER the order-level o.status='rejected'
--     branch. On a single-seller order seller_decision becomes 'rejected' ONLY when
--     the order is also 'rejected' (seller_reject_group drives recompute →
--     status='rejected'; the 2a backfill set it the same way), so the order-level
--     branch already fires first — the new branch is unreachable for single-seller
--     rows and changes no output.
--   • «own accepted & paid_by_customer & order still rank 0 → 'preparing'» only fires
--     while order_status_rank(o.status)=0 (new/received/payreview). A single-seller
--     accept always flips the order to 'preparing' (rank 1), so a single-seller
--     rank-0 order is always still 'pending' — the new branch is likewise
--     unreachable for single-seller rows.
--   The two new branches only bite on genuine multi-seller orders where THIS seller
--   has decided but the order has not (other sellers still pending).
--
-- The additive columns are ignored by today's client mapper (rowToSellerOrder reads
-- only internal_status / reject_reason); the Phase-B client reads them for the
-- banner. Admin (is_admin()) keeps the pre-existing "first group" projection.
--
-- Pre-image: supabase/rollback/20260729_orders_seller_facing_seller_decision_preimage.sql
-- Idempotent (create or replace, columns appended at tail). No data modified.
-- Target project: niloddwnllhsvrmuxfxw (apply pending approval).
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
    o.items,
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
    -- Additive columns APPENDED at the end so CREATE OR REPLACE VIEW is legal
    -- (it may only add columns to the tail, never reorder existing ones).
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
