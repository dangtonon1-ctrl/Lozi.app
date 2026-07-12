-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PRE-IMAGE for 20260731_orders_seller_facing_failopen_items.
--
-- Restores public.orders_seller_facing to its post-20260730 definition (live md5
-- 748ba6bb79b34b83fd25208e6092d90c), where an unresolvable item falls back to
-- o.seller_vendor_id (the primary) instead of failing open to the caller.
-- Only the `items` filter's coalesce fallback differs, so this is an in-place
-- CREATE OR REPLACE — no column add/remove, grants untouched.
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
                    o.seller_vendor_id
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
