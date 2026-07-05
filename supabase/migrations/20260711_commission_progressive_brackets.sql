-- ============================================================================
-- Lozi — Commission fix: flat single-tier rate → progressive/marginal brackets
-- ============================================================================
-- BUG: the engine looked up ONE tier from the seller's cumulative sales and
-- multiplied the whole order by that single rate. Any order whose goods span
-- more than one tier band was mis-charged. Example (retail, seller at 0):
--   310,000 order → froze at "Level 2" and charged 1.75% on all 310,000 =
--   5,425 (wrong).
--
-- FIX: charge progressively, like tax brackets. The order pushes the seller's
-- counter from `before` to `before + goods`; each slice of that span is charged
-- at the rate of the band it falls in:
--   first 10,000 @ 2.00% + next 40,000 @ 1.75% + next 50,000 @ 1.50% +
--   remaining 210,000 @ 1.25% = 4,275 (correct).
--
-- Only the amount math changes. Segment resolution, the delivery-fee exclusion,
-- the cumulative counter, and the reversal zero-floor are all left untouched.
-- Idempotent (create or replace); supersedes the flat-rate bodies from
-- 20260628_commission_system.sql and 20260709_hub_spoke_fulfillment.sql.
-- ============================================================================

-- ── Marginal bracket calculator (single source of truth for the amount) ─────
-- Commission on the span [before, before+goods] of cumulative sales. A band's
-- upper bound is the NEXT tier's min_sales, so the stored max_sales off-by-one
-- (e.g. 9,999 vs the next tier's 10,000) never leaves an un-charged gap. The
-- top tier has no next row → a sentinel well above any possible numeric(14,2).
create or replace function public.commission_bracket(
  p_segment text, p_before numeric, p_goods numeric)
returns numeric language sql stable set search_path = public as $$
  with bands as (
    select t.rate,
           t.min_sales as lo,
           coalesce(lead(t.min_sales) over (order by t.level), 1000000000000000::numeric) as hi
    from public.commission_tiers t
    where t.segment = p_segment
  ),
  span as (
    select greatest(coalesce(p_before, 0), 0) as s,
           greatest(coalesce(p_before, 0), 0) + greatest(coalesce(p_goods, 0), 0) as e
  )
  select round(coalesce(sum(
           greatest(least(span.e, bands.hi) - greatest(span.s, bands.lo), 0) * bands.rate
         ), 0), 2)
  from bands, span;
$$;
grant execute on function public.commission_bracket(text, numeric, numeric) to anon, authenticated;

-- ── Charge at completion — progressive amount ───────────────────────────────
-- commission_rate_applied now stores the BLENDED effective rate (commission ÷
-- goods): a single tier rate no longer describes the charge, and the blended
-- value keeps the receipt internally consistent (rate × goods ≈ amount).
create or replace function public.charge_commission(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
$$;
revoke all on function public.charge_commission(uuid) from public, anon, authenticated;

-- ── Hub-inspection read-only snapshot — same progressive math ───────────────
-- Returns the bracket commission for a would-be order, starting the span at the
-- seller's CURRENT counter (the snapshot does not advance it). Companion to the
-- existing get_commission_rate; both stay owner-context only.
create or replace function public.get_commission_amount(
  p_seller_id uuid, p_sale_channel text, p_goods numeric, p_cumulative_total numeric default null)
returns numeric language sql stable security definer set search_path = public as $$
  select public.commission_bracket(
    case when p_sale_channel = 'wholesale' then 'wholesale' else 'retail' end,
    coalesce(
      p_cumulative_total,
      case when p_sale_channel = 'wholesale'
           then (select wholesale_cumulative_sales from public.profiles where user_id = p_seller_id)
           else (select retail_cumulative_sales    from public.profiles where user_id = p_seller_id)
      end,
      0),
    coalesce(p_goods, 0));
$$;
revoke all on function public.get_commission_amount(uuid, text, numeric, numeric) from public, anon, authenticated;

create or replace function public.osg_on_inspect()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text; v_comm numeric;
begin
  if OLD.fulfillment_status = 'pending_hub_delivery'
     and NEW.fulfillment_status = 'inspected_and_received' then
    select coalesce(o.segment, public.resolve_order_segment(o.items, o.seller_vendor_id), 'retail')
      into v_channel
      from public.orders o
     where o.id = NEW.order_id;

    v_comm := public.get_commission_amount(
      NEW.seller_id, coalesce(v_channel, 'retail'), coalesce(NEW.subtotal_amount, 0), null);

    NEW.hub_received_at     := now();
    NEW.platform_commission := v_comm;
    NEW.seller_net_amount   := round(coalesce(NEW.subtotal_amount, 0) - v_comm, 2);
    NEW.delivery_fee_yer    := 1000;                        -- per seller-group
    NEW.fulfillment_status  := 'out_for_delivery';          -- auto-advance past inspected
  end if;
  return NEW;
end $$;
revoke all on function public.osg_on_inspect() from public, anon, authenticated;

drop trigger if exists trg_osg_on_inspect on public.order_seller_groups;
create trigger trg_osg_on_inspect
  before update of fulfillment_status on public.order_seller_groups
  for each row execute function public.osg_on_inspect();

-- NOTE: Already-charged orders keep their original frozen snapshot — the system
-- records commission once at completion and never recomputes it (see
-- 20260628_commission_system.sql). This fix therefore applies to every NEW
-- charge and hub-inspection preview from here forward; historical rows are left
-- untouched so their commission_amount stays in step with any payout already
-- made and with the order_seller_groups snapshots.
