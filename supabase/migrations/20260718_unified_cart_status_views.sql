-- Unified-cart step 1: make the two order status views multi-seller-correct.
--
-- Background: a LOZI order is moving toward containing items from MULTIPLE sellers,
-- each tracked as one row in public.order_seller_groups (see 20260709_hub_spoke_fulfillment
-- and 20260705133326 seller_status_views_self_scope, which created the current views).
--
-- The previous definitions joined the seller-groups with
--     LEFT JOIN LATERAL (... ORDER BY g.created_at LIMIT 1)
-- i.e. ONE arbitrary group decided the whole order's displayed stage. For a
-- multi-seller order that is wrong. orders_seller_facing additionally scoped the
-- order by o.seller_vendor_id = auth.uid(), so a secondary seller could not see the
-- order at all.
--
-- This migration is server-side only, views-only, and fully backward compatible:
-- for a single-group order every aggregate below collapses to that one group's value
-- (aggregate-of-one = the one), so single-seller output is byte-for-byte identical.
-- Commission, the delivery-fee trigger, RLS policies and the client are untouched.
-- Both views keep security_invoker = on.
--
-- order_fulfillment_status progression (rejected_at_hub / returned_by_customer /
-- disputed are off the happy path):
--   paid_by_customer -> pending_hub_delivery -> inspected_and_received
--   -> out_for_delivery -> delivered_to_customer

-- ---------------------------------------------------------------------------
-- 1) Customer-facing: the LEAST-advanced live (non-rejected) seller-group decides
--    the stage. Evaluated top-down over bool_and(...) aggregates, so:
--      * 'delivered'  only when ALL live groups are delivered_to_customer
--      * 'delivering' only when ALL live groups are at delivering-or-beyond
--                     (>= inspected_and_received, matching the prior single-group
--                      mapping so single-seller behavior never drifts)
--      * 'to_hub'     only when ALL live groups have reached the hub, otherwise the
--                     laggard group pulls the order back to preparing/received.
--    Rejected groups (fulfillment_status = 'rejected_at_hub') are excluded from the
--    aggregation, so a partial rejection never blocks the rest of the order.
-- ---------------------------------------------------------------------------
create or replace view public.orders_customer_facing
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
        when o.status = 'cancelled' then 'cancelled'
        when o.status = 'rejected' then 'rejected'
        when o.pay_status = 'rejected' then 'payreview'
        when o.status = 'payreview' then 'payreview'
        when o.status = 'delivered' or coalesce(agg.all_delivered, false) then 'delivered'
        when o.status = 'delivering' or coalesce(agg.all_delivering, false) then 'delivering'
        when coalesce(agg.all_to_hub, false) then 'to_hub'
        when o.status = 'preparing' then 'preparing'
        else 'received'
    end as customer_facing_status
from orders o
left join lateral (
    select
        bool_and(g.fulfillment_status = 'delivered_to_customer') as all_delivered,
        bool_and(
            g.fulfillment_status in ('inspected_and_received', 'out_for_delivery', 'delivered_to_customer')
            or g.seller_payout_status in ('paid_cash', 'paid_transfer')
        ) as all_delivering,
        bool_and(
            g.fulfillment_status in ('pending_hub_delivery', 'inspected_and_received', 'out_for_delivery', 'delivered_to_customer')
            or g.seller_payout_status in ('paid_cash', 'paid_transfer')
        ) as all_to_hub
    from order_seller_groups g
    where g.order_id = o.id
      and g.fulfillment_status <> 'rejected_at_hub'
) agg on true
where o.customer_id = auth.uid() or is_admin();

-- ---------------------------------------------------------------------------
-- 2) Seller-facing: scope by GROUP MEMBERSHIP (a seller sees the order if they own
--    one of its groups) and show THAT seller's OWN group's stage. The status CASE
--    is unchanged from before -- each seller's stage is inherently their own group.
--    For admins (not a seller of any group) the lateral falls back to the earliest
--    group, preserving the prior admin behavior.
-- ---------------------------------------------------------------------------
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
        when o.status = 'delivered' or g.fulfillment_status = 'delivered_to_customer' then 'delivered'
        when g.seller_payout_status in ('paid_cash', 'paid_transfer') then 'seller_paid'
        when g.fulfillment_status in ('inspected_and_received', 'out_for_delivery') then 'at_hub'
        when g.fulfillment_status = 'pending_hub_delivery' then 'to_hub'
        when o.status = 'preparing' then 'preparing'
        else 'new'
    end as internal_status
from orders o
left join lateral (
    select g.fulfillment_status, g.seller_payout_status
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
