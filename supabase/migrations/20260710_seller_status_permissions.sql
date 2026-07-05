-- ════════════════════════════════════════════════════════════════════════════
-- Seller order-status permissions + customer-facing status split
--
-- BUG (audit, 2026-07-05):
--   From a seller account the seller could advance an order through the ENTIRE
--   lifecycle by itself — بدء التجهيز → خرج للتوصيل → تم التسليم — and the
--   customer's tracker INSTANTLY showed the order as delivered (all green),
--   before the goods had even reached the hub (بيت المكسرات).
--
--   Root cause (two parts):
--     1. RLS: policy `orders_seller_update` allowed a seller to UPDATE its own
--        order rows with NO restriction on the target `status` value — its
--        USING/WITH CHECK only asserted `auth.uid() = seller_vendor_id`. So the
--        seller's client could write status='delivered' (or any value) directly.
--        Hiding the button client-side never stopped a raw API write.
--     2. UI: SELLER_FLOW advanced new→preparing→delivering→delivered, and the
--        customer tracker read orders.status verbatim, so the seller's write to
--        'delivered' was shown to the customer as a (false) delivery.
--
-- FIX (this migration — DB half; the UI half is in src/scripts/app.core.js):
--   • Constrain the seller UPDATE policy so a seller may ONLY move status into
--     'preparing' (بدء التجهيز) or 'rejected' (decline the order), and only from
--     a pre-hub state. Every step 3–5 transition (received at hub / seller paid /
--     delivered) attempted from a seller session is now REJECTED by RLS.
--   • Seller step 2 (التوصيل لنقطة لوزي / en route to hub) is recorded on the
--     admin-only order_seller_groups table via a SECURITY DEFINER RPC
--     (seller_mark_to_hub); the seller has no direct write to that table and the
--     RPC only ever advances paid_by_customer → pending_hub_delivery.
--   • Steps 3–5 (received at hub / seller paid / delivered to customer) stay
--     admin-only exactly as before (osg_admin + admin_set_order_status).
--   • Add two security_invoker views that translate the internal fulfillment
--     state into (a) the 4 customer-visible states and (b) the 5 seller-visible
--     states, so NEITHER UI reads the raw internal status. The customer never
--     sees hub inspection or seller payout.
--
-- orders.status vocabulary and ranks are DELIBERATELY unchanged, so the admin
-- lifecycle state machine (20260708) and its client-side rank mirror in
-- admin.js keep working untouched.
--
-- Idempotent: safe to run more than once.
-- Applied to project niloddwnllhsvrmuxfxw.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Lock down the seller UPDATE policy (root-cause fix) ───────────────────
-- Before: USING/CHECK asserted only ownership → a seller could set ANY status
-- (incl. 'delivered'). After: a seller may only turn a still-pre-hub order into
-- 'preparing' (start prep) or 'rejected' (decline). Anything else — most
-- importantly 'delivering' / 'delivered' — fails WITH CHECK and is denied; and
-- an order already 'delivering'/'delivered'/terminal fails USING, so it cannot
-- be touched by the seller at all.
drop policy if exists orders_seller_update on public.orders;
create policy orders_seller_update on public.orders for update to authenticated
  using (
    auth.uid() = seller_vendor_id
    and status in ('new','received','payreview','preparing')
  )
  with check (
    auth.uid() = seller_vendor_id
    and status in ('preparing','rejected')
  );

-- ── 2. seller_mark_to_hub — seller step 2 (التوصيل لنقطة لوزي) ───────────────
-- The seller declares the goods are on their way to the hub (بيت المكسرات).
-- This is a supply-side fact on order_seller_groups, which sellers cannot write
-- directly (admin-only RLS). SECURITY DEFINER + an explicit ownership check let
-- the seller advance ONLY their own group, ONLY forward
-- (paid_by_customer → pending_hub_delivery), and ONLY once the order is in
-- preparation. It can never reach hub-receipt / payout / delivered.
create or replace function public.seller_mark_to_hub(p_order_no text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders
   where order_no = p_order_no and seller_vendor_id = auth.uid();
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'preparing' then
    raise exception 'order must be in preparation before it can be sent to the hub';
  end if;

  update public.order_seller_groups
     set fulfillment_status = 'pending_hub_delivery'
   where order_id  = o.id
     and seller_id = auth.uid()
     and fulfillment_status = 'paid_by_customer';   -- forward-only, no regression
end $$;
revoke all on function public.seller_mark_to_hub(text) from public, anon;
grant  execute on function public.seller_mark_to_hub(text) to authenticated;

-- ── 3. Internal → customer-facing status mapping (view) ─────────────────────
-- The customer tracker must NEVER read the internal fulfillment status. This
-- view collapses the 5 internal states down to the 4 the customer may see:
--   بدء التجهيز · التوصيل لنقطة لوزي · التوصيل للعميل · تم التسليم
-- The two hidden internal steps (hub inspection, seller payout) both surface as
-- the single customer state 'delivering' (التوصيل للعميل), so the customer jumps
-- straight from 'to_hub' to 'delivering', never seeing the hub/payout steps.
--
-- The view SELF-SCOPES with `customer_id = auth.uid()`. This is essential:
-- RLS on public.orders is PERMISSIVE (orders_customer_read OR orders_seller_read
-- OR orders_admin), so security_invoker alone would let a user who is BOTH a
-- customer and a seller pull rows through the wrong lens. The explicit predicate
-- guarantees this view only ever exposes a caller's own *purchases*.
create or replace view public.orders_customer_facing
with (security_invoker = on) as
select
  o.*,
  case
    when o.status = 'cancelled'                            then 'cancelled'
    when o.status = 'rejected'                             then 'rejected'
    when o.pay_status = 'rejected'                         then 'payreview'
    when o.status = 'payreview'                            then 'payreview'
    when o.status = 'delivered'
      or g.fulfillment_status = 'delivered_to_customer'    then 'delivered'
    when o.status = 'delivering'
      or g.fulfillment_status in ('inspected_and_received','out_for_delivery')
      or g.seller_payout_status in ('paid_cash','paid_transfer')
                                                           then 'delivering'
    when g.fulfillment_status = 'pending_hub_delivery'     then 'to_hub'
    when o.status = 'preparing'                            then 'preparing'
    else 'received'
  end as customer_facing_status
from public.orders o
left join lateral (
  -- single-seller orders today (one group per order); pick the group's row.
  select fulfillment_status, seller_payout_status
  from public.order_seller_groups g
  where g.order_id = o.id
  order by g.created_at
  limit 1
) g on true
where o.customer_id = auth.uid() or public.is_admin();
grant select on public.orders_customer_facing to authenticated;

-- ── 4. Internal → seller-facing status mapping (view) ───────────────────────
-- The seller sees the full 5-step tracker for transparency, but only the first
-- two steps are actionable (enforced by the RLS policy + RPC above). Steps 3–5
-- are derived read-only from the admin-managed group:
--   بدء التجهيز · التوصيل لنقطة لوزي · تم استلام البضاعة · تم الدفع · تم التسليم للزبون
--
-- SELF-SCOPES with `seller_vendor_id = auth.uid()` for the same reason as the
-- customer view: RLS on public.orders is PERMISSIVE (customer OR seller OR admin
-- policies are OR'd), so without this predicate a caller who is BOTH a customer
-- and a seller could pull their own *purchases* through the seller lens and read
-- the internal fulfillment status — exactly the hub/payout detail that must stay
-- hidden. Only the caller's own *sales* are returned.
create or replace view public.orders_seller_facing
with (security_invoker = on) as
select
  o.*,
  case
    when o.status = 'rejected'                             then 'rejected'
    when o.status = 'cancelled'                            then 'cancelled'
    when o.status = 'delivered'
      or g.fulfillment_status = 'delivered_to_customer'    then 'delivered'      -- 5
    when g.seller_payout_status in ('paid_cash','paid_transfer')
                                                           then 'seller_paid'    -- 4
    when g.fulfillment_status in ('inspected_and_received','out_for_delivery')
                                                           then 'at_hub'         -- 3
    when g.fulfillment_status = 'pending_hub_delivery'     then 'to_hub'         -- 2
    when o.status = 'preparing'                            then 'preparing'      -- 1
    else 'new'
  end as internal_status
from public.orders o
left join lateral (
  select fulfillment_status, seller_payout_status
  from public.order_seller_groups g
  where g.order_id = o.id
  order by g.created_at
  limit 1
) g on true
where o.seller_vendor_id = auth.uid() or public.is_admin();
grant select on public.orders_seller_facing to authenticated;
