-- ============================================================================
-- ROLLBACK / PRE-IMAGE for unified-cart Step 4 (4a/4b/4c). NOT a forward migration.
-- Restores the exact pre-Step-4 live bodies of the two functions that 4c
-- replaces (charge_commission, reverse_commission), captured verbatim from
-- prod niloddwnllhsvrmuxfxw before 4c. osg_on_inspect and the triggers are NOT
-- touched by Step 4, so they need no restore.
--
-- Full reversal order (undo 4c, then 4b, then 4a):
--   1) run this file  → charge_commission / reverse_commission back to pre-Step-4
--   2) drop the 4b engine:
--        drop function if exists public.charge_group_commission(uuid);
--        drop function if exists public.reverse_group_commission(uuid, numeric);
--        drop function if exists public.resolve_group_segment(uuid, uuid);
--   3) drop the 4a schema (only if no per-group charge has been written yet):
--        alter table public.order_seller_groups
--          drop constraint if exists osg_commission_state_chk,
--          drop constraint if exists osg_commission_segment_chk,
--          drop column if exists commission_segment,
--          drop column if exists commission_rate_applied,
--          drop column if exists commission_amount,
--          drop column if exists cumulative_before,
--          drop column if exists commission_state,
--          drop column if exists reversed_amount;
-- ============================================================================

-- ── pre-Step-4 charge_commission (order-level, progressive brackets) ─────────
create or replace function public.charge_commission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare o public.orders%rowtype; v_seg text; v_goods numeric(14,2);
        v_c numeric(14,2); v_comm numeric(14,2); v_rate numeric(6,4);
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return; end if;
  if o.commission_state is not null then return; end if;
  v_seg   := coalesce(o.segment, public.resolve_order_segment(o.items, o.seller_vendor_id));
  v_goods := coalesce(o.goods_subtotal, coalesce(o.total,0) - coalesce(o.delivery_fee,0));
  if v_goods < 0 then v_goods := 0; end if;
  perform 1 from public.profiles where user_id = o.seller_vendor_id for update;
  if v_seg = 'wholesale' then
    select coalesce(wholesale_cumulative_sales,0) into v_c from public.profiles where user_id = o.seller_vendor_id;
  else
    select coalesce(retail_cumulative_sales,0)    into v_c from public.profiles where user_id = o.seller_vendor_id;
  end if;
  v_c    := coalesce(v_c, 0);
  v_comm := public.commission_bracket(v_seg, v_c, v_goods);
  v_rate := case when v_goods > 0 then round(v_comm / v_goods, 4) else 0 end;
  update public.orders set segment=v_seg, goods_subtotal=v_goods, commission_rate_applied=v_rate,
    commission_amount=v_comm, cumulative_before=v_c, commission_state='charged', reversed_amount=0
  where id = p_order_id;
  if v_seg = 'wholesale' then
    update public.profiles set wholesale_cumulative_sales = coalesce(wholesale_cumulative_sales,0) + v_goods where user_id = o.seller_vendor_id;
  else
    update public.profiles set retail_cumulative_sales    = coalesce(retail_cumulative_sales,0)    + v_goods where user_id = o.seller_vendor_id;
  end if;
end;
$function$;

-- ── pre-Step-4 reverse_commission (order-level; full or partial) ─────────────
create or replace function public.reverse_commission(p_order_id uuid, p_returned_goods numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o            public.orders%rowtype;
  v_ret_goods  numeric(14,2);
  v_already_g  numeric(14,2);
  v_max_more   numeric(14,2);
  v_refund     numeric(14,2);
  v_new_rev    numeric(14,2);
  v_new_state  text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return; end if;
  if o.commission_state is null or o.commission_state = 'reversed' then return; end if;
  if coalesce(o.goods_subtotal,0) <= 0 then return; end if;

  v_already_g := round(o.goods_subtotal * (coalesce(o.reversed_amount,0) / nullif(o.commission_amount,0)), 2);
  v_max_more  := greatest(o.goods_subtotal - coalesce(v_already_g,0), 0);

  if p_returned_goods is null then
    v_ret_goods := v_max_more;
  else
    v_ret_goods := least(greatest(p_returned_goods,0), v_max_more);
  end if;
  if v_ret_goods <= 0 then return; end if;

  v_refund  := round(o.commission_amount * (v_ret_goods / o.goods_subtotal), 2);
  v_new_rev := round(coalesce(o.reversed_amount,0) + v_refund, 2);
  if v_new_rev > o.commission_amount then v_new_rev := o.commission_amount; end if;

  if (v_already_g + v_ret_goods) >= o.goods_subtotal then
    v_new_state := 'reversed';
    v_new_rev   := o.commission_amount;
  else
    v_new_state := 'partially_reversed';
  end if;

  perform 1 from public.profiles where user_id = o.seller_vendor_id for update;

  update public.orders set
    reversed_amount  = v_new_rev,
    commission_state = v_new_state
  where id = p_order_id;

  if o.segment = 'wholesale' then
    update public.profiles
       set wholesale_cumulative_sales = greatest(coalesce(wholesale_cumulative_sales,0) - v_ret_goods, 0)
     where user_id = o.seller_vendor_id;
  else
    update public.profiles
       set retail_cumulative_sales = greatest(coalesce(retail_cumulative_sales,0) - v_ret_goods, 0)
     where user_id = o.seller_vendor_id;
  end if;
end;
$function$;
