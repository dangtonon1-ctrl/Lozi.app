-- ============================================================================
-- Unified-cart Step 4b — per-seller commission engine (server-only).
-- New functions, NOT yet wired to any trigger/orchestrator (4c does that):
--   * resolve_group_segment(order, seller) — segment from THAT seller's items
--   * charge_group_commission(group)       — authoritative per-group charge
--   * reverse_group_commission(group, ret) — authoritative per-group reversal
-- Same progressive-bracket math (commission_bracket), same rounding, same
-- zero-floor as the live order-level engine. Each seller advances/decrements
-- only their OWN retail/wholesale counter, on their own goods subtotal.
-- ============================================================================

-- ── Segment resolver scoped to a single seller's slice of the order ──────────
-- Mirrors resolve_order_segment(), but only considers items that belong to
-- p_seller (item seller = product.vendor_id, falling back to orders.seller_vendor_id,
-- exactly as sync_order_seller_groups / the delivery-fee trigger resolve it).
-- For a single-seller order the seller owns every item, so this returns the
-- identical value to resolve_order_segment(o.items, o.seller_vendor_id).
create or replace function public.resolve_group_segment(p_order_id uuid, p_seller uuid)
returns text
language plpgsql
stable
set search_path = public
as $function$
declare o public.orders%rowtype; v_seg text; v_role text;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return 'retail'; end if;

  select p.market_segment into v_seg
  from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
  join public.products p on p.id = (it->>'p')::uuid
  where p.market_segment in ('retail','wholesale')
    and coalesce(p.vendor_id, o.seller_vendor_id) = p_seller
  limit 1;
  if v_seg is not null then return v_seg; end if;

  select role into v_role from public.profiles where user_id = p_seller;
  if coalesce(v_role,'') ilike '%wholesale%' then return 'wholesale'; end if;
  return 'retail';
exception when others then return 'retail';
end;
$function$;

-- ── Authoritative per-group charge (advances that seller's counter once) ─────
create or replace function public.charge_group_commission(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.order_seller_groups%rowtype; v_seg text; v_goods numeric(14,2);
        v_c numeric(14,2); v_comm numeric(14,2); v_rate numeric(6,4);
begin
  select * into g from public.order_seller_groups where id = p_group_id for update;
  if not found then return; end if;
  if g.commission_state is not null then return; end if;             -- per-group once-only guard
  if g.seller_id is null then return; end if;                        -- unresolved seller
  if g.seller_decision = 'rejected'
     or g.fulfillment_status = 'rejected_at_hub' then return; end if; -- rejected slices never charge

  v_seg   := coalesce(public.resolve_group_segment(g.order_id, g.seller_id), 'retail');
  v_goods := greatest(coalesce(g.subtotal_amount, 0), 0);

  perform 1 from public.profiles where user_id = g.seller_id for update;
  if v_seg = 'wholesale' then
    select coalesce(wholesale_cumulative_sales,0) into v_c from public.profiles where user_id = g.seller_id;
  else
    select coalesce(retail_cumulative_sales,0)    into v_c from public.profiles where user_id = g.seller_id;
  end if;
  v_c    := coalesce(v_c, 0);
  v_comm := public.commission_bracket(v_seg, v_c, v_goods);
  v_rate := case when v_goods > 0 then round(v_comm / v_goods, 4) else 0 end;

  update public.order_seller_groups set
    commission_segment      = v_seg,
    commission_rate_applied = v_rate,
    commission_amount       = v_comm,
    cumulative_before       = v_c,
    commission_state        = 'charged',
    reversed_amount         = 0
  where id = p_group_id;

  if v_seg = 'wholesale' then
    update public.profiles set wholesale_cumulative_sales = coalesce(wholesale_cumulative_sales,0) + v_goods where user_id = g.seller_id;
  else
    update public.profiles set retail_cumulative_sales    = coalesce(retail_cumulative_sales,0)    + v_goods where user_id = g.seller_id;
  end if;
end;
$function$;

-- ── Authoritative per-group reversal (full when ret is NULL; else partial) ───
create or replace function public.reverse_group_commission(p_group_id uuid, p_returned_goods numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.order_seller_groups%rowtype; v_ret_goods numeric(14,2); v_already_g numeric(14,2);
        v_max_more numeric(14,2); v_refund numeric(14,2); v_new_rev numeric(14,2); v_new_state text;
begin
  select * into g from public.order_seller_groups where id = p_group_id for update;
  if not found then return; end if;
  if g.commission_state is null or g.commission_state = 'reversed' then return; end if;
  if coalesce(g.subtotal_amount,0) <= 0 then return; end if;

  v_already_g := round(g.subtotal_amount * (coalesce(g.reversed_amount,0) / nullif(g.commission_amount,0)), 2);
  v_max_more  := greatest(g.subtotal_amount - coalesce(v_already_g,0), 0);
  if p_returned_goods is null then v_ret_goods := v_max_more;
  else v_ret_goods := least(greatest(p_returned_goods,0), v_max_more); end if;
  if v_ret_goods <= 0 then return; end if;

  v_refund  := round(g.commission_amount * (v_ret_goods / g.subtotal_amount), 2);
  v_new_rev := round(coalesce(g.reversed_amount,0) + v_refund, 2);
  if v_new_rev > g.commission_amount then v_new_rev := g.commission_amount; end if;
  if (v_already_g + v_ret_goods) >= g.subtotal_amount then v_new_state := 'reversed'; v_new_rev := g.commission_amount;
  else v_new_state := 'partially_reversed'; end if;

  perform 1 from public.profiles where user_id = g.seller_id for update;
  update public.order_seller_groups set reversed_amount = v_new_rev, commission_state = v_new_state where id = p_group_id;

  if g.commission_segment = 'wholesale' then
    update public.profiles set wholesale_cumulative_sales = greatest(coalesce(wholesale_cumulative_sales,0) - v_ret_goods, 0) where user_id = g.seller_id;
  else
    update public.profiles set retail_cumulative_sales = greatest(coalesce(retail_cumulative_sales,0) - v_ret_goods, 0) where user_id = g.seller_id;
  end if;
end;
$function$;

-- ── Hygiene: mirror charge_commission's hardening on the two money movers ─────
revoke all on function public.charge_group_commission(uuid)          from public, anon, authenticated;
revoke all on function public.reverse_group_commission(uuid, numeric) from public, anon, authenticated;
grant execute on function public.charge_group_commission(uuid)          to service_role;
grant execute on function public.reverse_group_commission(uuid, numeric) to service_role;
-- resolve_group_segment is a read-only invoker helper (mirrors resolve_order_segment).
