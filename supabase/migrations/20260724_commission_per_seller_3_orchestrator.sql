-- ============================================================================
-- Unified-cart Step 4c — per-seller commission orchestrator cutover (server-only).
-- Re-implements the order-level entry points to drive the per-group engine (4b),
-- WITHOUT moving the trigger point: charge still fires on orders.status='delivered'
-- (trg_orders_commission_sync[_ins]); reverse still fires on cancel/reject/return
-- and admin backward/manual. Per-seller INDEPENDENT timing (a group trigger) is
-- deliberately NOT built here — deferred as Step 4d, decision-gated.
--
-- Guarantees:
--  * Single-seller orders charge & reverse BYTE-IDENTICALLY to the old engine
--    (one group, same base, same bracket math, same counter delta).
--  * No double charge: order-level guard AND per-group guard both hold, so a
--    group is charged at most once regardless of how many entry points fire.
--  * Legacy orders charged by the OLD order-level engine (no per-group rows)
--    still reverse EXACTLY as before, via the verbatim fallback branch.
--  * orders.commission_amount / reversed_amount become display roll-ups (Σ groups).
-- ============================================================================

-- ── charge: loop each eligible group, then roll the sum onto the order ───────
create or replace function public.charge_commission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype; g record;
  v_n int; v_tot_comm numeric(14,2); v_tot_goods numeric(14,2);
  v_seg text; v_cum numeric(14,2); v_rate numeric(6,4);
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return; end if;
  if o.commission_state is not null then return; end if;          -- order-level once-only guard

  -- Authoritative per-seller charge: each eligible (non-rejected) group on its
  -- own goods subtotal / segment / cumulative counter. charge_group_commission
  -- is itself idempotent (per-group guard), so this can never double-charge.
  for g in
    select id from public.order_seller_groups
     where order_id = p_order_id
       and seller_id is not null
       and seller_decision   <> 'rejected'
       and fulfillment_status <> 'rejected_at_hub'
     order by created_at, id
  loop
    perform public.charge_group_commission(g.id);
  end loop;

  -- Roll the per-group results up onto the order (display sum + single-seller parity).
  select count(*), coalesce(sum(commission_amount),0), coalesce(sum(subtotal_amount),0)
    into v_n, v_tot_comm, v_tot_goods
    from public.order_seller_groups
   where order_id = p_order_id and commission_state = 'charged';

  if v_n = 0 then return; end if;   -- nothing chargeable (e.g. every slice rejected) → leave uncharged

  if v_n = 1 then
    -- exactly one seller → copy its exact fields so the order row is byte-identical to the old engine
    select commission_segment, cumulative_before
      into v_seg, v_cum
      from public.order_seller_groups
     where order_id = p_order_id and commission_state = 'charged';
  else
    v_seg := coalesce(o.segment, public.resolve_order_segment(o.items, o.seller_vendor_id));
    v_cum := null;   -- ambiguous across multiple sellers/tracks
  end if;
  v_rate := case when v_tot_goods > 0 then round(v_tot_comm / v_tot_goods, 4) else 0 end;

  update public.orders set
    segment                 = coalesce(segment, v_seg),
    goods_subtotal          = v_tot_goods,
    commission_rate_applied = v_rate,
    commission_amount       = v_tot_comm,
    cumulative_before       = v_cum,
    commission_state        = 'charged',
    reversed_amount         = 0
  where id = p_order_id;
end;
$function$;

-- ── reverse: per-group when the order was charged per-group; else legacy body ─
create or replace function public.reverse_commission(p_order_id uuid, p_returned_goods numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype; g record; v_remaining numeric(14,2);
  v_tot_comm numeric(14,2); v_tot_rev numeric(14,2);
  -- legacy-branch locals (verbatim from the pre-Step-4 order-level engine)
  v_ret_goods numeric(14,2); v_already_g numeric(14,2); v_max_more numeric(14,2);
  v_refund numeric(14,2); v_new_rev numeric(14,2); v_new_state text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return; end if;
  if o.commission_state is null or o.commission_state = 'reversed' then return; end if;

  if exists (select 1 from public.order_seller_groups
              where order_id = p_order_id
                and commission_state in ('charged','partially_reversed')) then
    -- ── per-group path (orders charged by the Step-4 engine) ──
    if p_returned_goods is null then
      for g in select id from public.order_seller_groups
                where order_id = p_order_id and commission_state in ('charged','partially_reversed')
                order by created_at, id
      loop
        perform public.reverse_group_commission(g.id, null);
      end loop;
    else
      -- partial: consume the requested goods across charged groups (single-seller: one group)
      v_remaining := greatest(p_returned_goods, 0);
      for g in select id, subtotal_amount from public.order_seller_groups
                where order_id = p_order_id and commission_state in ('charged','partially_reversed')
                order by created_at, id
      loop
        exit when v_remaining <= 0;
        perform public.reverse_group_commission(g.id, v_remaining);
        v_remaining := greatest(v_remaining - coalesce(g.subtotal_amount,0), 0);
      end loop;
    end if;

    select coalesce(sum(commission_amount) filter (where commission_state is not null),0),
           coalesce(sum(reversed_amount)  filter (where commission_state is not null),0)
      into v_tot_comm, v_tot_rev
      from public.order_seller_groups
     where order_id = p_order_id;

    update public.orders set
      reversed_amount  = v_tot_rev,
      commission_state = case
          when v_tot_rev <= 0            then 'charged'
          when v_tot_rev >= v_tot_comm   then 'reversed'
          else 'partially_reversed' end
    where id = p_order_id;
    return;
  end if;

  -- ── legacy fallback: order was charged by the OLD order-level engine
  --    (no per-group commission rows). Verbatim pre-Step-4 reversal so these
  --    orders reverse byte-identically. ──
  if coalesce(o.goods_subtotal,0) <= 0 then return; end if;
  v_already_g := round(o.goods_subtotal * (coalesce(o.reversed_amount,0) / nullif(o.commission_amount,0)), 2);
  v_max_more  := greatest(o.goods_subtotal - coalesce(v_already_g,0), 0);
  if p_returned_goods is null then v_ret_goods := v_max_more;
  else v_ret_goods := least(greatest(p_returned_goods,0), v_max_more); end if;
  if v_ret_goods <= 0 then return; end if;
  v_refund  := round(o.commission_amount * (v_ret_goods / o.goods_subtotal), 2);
  v_new_rev := round(coalesce(o.reversed_amount,0) + v_refund, 2);
  if v_new_rev > o.commission_amount then v_new_rev := o.commission_amount; end if;
  if (v_already_g + v_ret_goods) >= o.goods_subtotal then v_new_state := 'reversed'; v_new_rev := o.commission_amount;
  else v_new_state := 'partially_reversed'; end if;
  perform 1 from public.profiles where user_id = o.seller_vendor_id for update;
  update public.orders set reversed_amount = v_new_rev, commission_state = v_new_state where id = p_order_id;
  if o.segment = 'wholesale' then
    update public.profiles set wholesale_cumulative_sales = greatest(coalesce(wholesale_cumulative_sales,0) - v_ret_goods, 0) where user_id = o.seller_vendor_id;
  else
    update public.profiles set retail_cumulative_sales = greatest(coalesce(retail_cumulative_sales,0) - v_ret_goods, 0) where user_id = o.seller_vendor_id;
  end if;
end;
$function$;

-- grants unchanged (create-or-replace preserves the existing ACL:
-- postgres + service_role only; revoked from public/anon/authenticated).
