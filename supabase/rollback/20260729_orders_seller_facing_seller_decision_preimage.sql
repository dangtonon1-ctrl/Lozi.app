-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PRE-IMAGE for 20260729_orders_seller_facing_seller_decision.
--
-- Restores public.orders_seller_facing to its EXACT pre-Phase-A definition (as last
-- set by 20260718_unified_cart_status_views and confirmed live in prod
-- niloddwnllhsvrmuxfxw via pg_get_viewdef): the original 23-column projection with
-- the pre-Phase-A internal_status CASE and WITHOUT the three additive columns
-- (seller_decision, decline_reason, refund_owed_yer).
--
-- NOTE: the forward migration appends columns, and CREATE OR REPLACE VIEW cannot
-- REMOVE columns — so this rollback must DROP then recreate the view, then re-issue
-- the grants (anon/authenticated/service_role) that the DROP discards. The view has
-- no SQL dependents (verified via pg_depend), is not part of any realtime
-- publication (only the base tables orders / order_seller_groups are), and holds no
-- RLS policies of its own (security_invoker delegates to the base-table RLS), so the
-- DROP is safe.
-- ════════════════════════════════════════════════════════════════════════════

drop view if exists public.orders_seller_facing;

create view public.orders_seller_facing
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

-- Restore the grants the DROP discarded (matches the observed prod ACL).
grant all on public.orders_seller_facing to anon, authenticated, service_role;
