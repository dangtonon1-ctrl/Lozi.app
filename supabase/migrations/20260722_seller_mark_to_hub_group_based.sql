-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 3b — make seller_mark_to_hub's order lookup group-based.
--
-- Before: the lookup found the order by (order_no AND seller_vendor_id = auth.uid()),
-- so a SECONDARY seller could not advance their own group even though the inner
-- update was already correctly scoped to seller_id = auth.uid().
--
-- Change: ONLY the order lookup — now "the caller owns a group on this order". The
-- status='preparing' guard and the inner group update are LEFT EXACTLY AS-IS
-- (per the approved decision): the update still advances only the caller's own group
-- and only paid_by_customer → pending_hub_delivery.
--
-- Backward-compatible: on the 17 single-seller orders group-membership ⇔
-- seller_vendor_id=auth.uid(), so behavior is identical; a seller with no group gets
-- 'order not found' exactly as before.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.seller_mark_to_hub(p_order_no text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  -- Group-membership lookup (was: seller_vendor_id = auth.uid()).
  select ord.* into o
    from public.orders ord
   where ord.order_no = p_order_no
     and exists (
       select 1 from public.order_seller_groups g
       where g.order_id = ord.id and g.seller_id = auth.uid()
     );
  if not found then raise exception 'order not found'; end if;

  if o.status <> 'preparing' then
    raise exception 'order must be in preparation before it can be sent to the hub';
  end if;

  -- Unchanged: advance ONLY the caller's own group, forward-only.
  update public.order_seller_groups
     set fulfillment_status = 'pending_hub_delivery'
   where order_id  = o.id
     and seller_id = auth.uid()
     and fulfillment_status = 'paid_by_customer';
end $$;
revoke all on function public.seller_mark_to_hub(text) from public, anon;
grant  execute on function public.seller_mark_to_hub(text) to authenticated;
