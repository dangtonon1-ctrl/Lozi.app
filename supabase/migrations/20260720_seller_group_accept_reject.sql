-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 2b — per-seller accept/reject: SERVER LOGIC (backward-compatible).
--
-- Builds on 2a's seller_decision column. Adds:
--   • recompute_order_status_from_groups() — derives orders.status from the group
--     decisions, governing ONLY the acceptance edge (rank 0 → preparing) and the
--     all-rejected terminal. Never touches an order already out for delivery / later.
--   • seller_accept_group()  — a seller accepts their own slice (= today's بدء التجهيز).
--   • seller_reject_group()  — a seller declines their own slice BEFORE the goods
--     head to the hub; computes the manual-refund flag, continues the order with the
--     remaining sellers, and only cancels (status='rejected') when EVERY seller has
--     rejected. Notifies the customer.
--   • notify_order_event()   — one additive 'seller_rejected' case (all other cases
--     preserved verbatim).
--   • orders_customer_facing — one additive predicate so a partially-rejected order
--     no longer stalls the customer's stage.
--
-- Backward-compatibility (single-seller = every order today):
--   • lone seller accepts  → all (one) live group accepted → orders.status='preparing'
--     — identical to today's updateOrderStatus(order,'preparing').
--   • lone seller rejects  → the only group rejected → all groups rejected →
--     orders.status='rejected', reject_reason set, refund_owed = subtotal + full fee
--     (= the whole order total) — identical to today's rejectSellerOrder, plus the
--     new refund flag + customer notification.
--   These RPCs are NOT yet called by the client (that is Step 2c); the existing
--   direct-write path (orders_seller_update policy) is left in place, so nothing
--   changes for the live app until the client is switched over.
--
-- Idempotent: safe to run more than once. Applied to project niloddwnllhsvrmuxfxw.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Status derivation from group decisions ───────────────────────────────
-- live groups := groups whose seller has NOT rejected. The order's acceptance
-- state is a function of those:
--   • no live groups (all rejected)      → status 'rejected'  (whole order cancelled)
--   • all live groups accepted           → status 'preparing' (only bump up from rank 0)
--   • otherwise (some live still pending) → leave status as-is
-- Guarded to rank <= 1 so it can never rewind an order that is already out for
-- delivery / delivered / in a terminal state. SECURITY DEFINER: it is only ever
-- invoked by the seller RPCs below (themselves definer) and writes orders.status
-- regardless of the seller's RLS.
create or replace function public.recompute_order_status_from_groups(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_total    int;
  v_live     int;
  v_accepted int;
begin
  select status into v_status from public.orders where id = p_order_id;
  if not found then return; end if;

  -- Only govern the acceptance edge; never touch out-for-delivery / delivered / etc.
  if public.order_status_rank(v_status) > 1 then return; end if;

  select count(*),
         count(*) filter (where seller_decision <> 'rejected'),
         count(*) filter (where seller_decision =  'accepted')
    into v_total, v_live, v_accepted
    from public.order_seller_groups
   where order_id = p_order_id;

  if v_total = 0 then return; end if;

  if v_live = 0 then
    -- every seller rejected → whole order is cancelled, labelled 'rejected' to stay
    -- byte-identical to today's lone-seller reject.
    if v_status <> 'rejected' then
      update public.orders set status = 'rejected' where id = p_order_id;
    end if;
  elsif v_accepted = v_live then
    -- all remaining live groups accepted → start preparation (only from rank 0).
    if public.order_status_rank(v_status) = 0 then
      update public.orders set status = 'preparing' where id = p_order_id;
    end if;
  end if;
  -- else: some live group still pending → leave orders.status untouched.
end $$;
revoke all on function public.recompute_order_status_from_groups(uuid) from public, anon, authenticated;

-- ── 2. seller_accept_group — the seller agrees to fulfil their slice ────────
-- Records 'accepted' on the caller's own group and re-derives orders.status. For a
-- single-seller order this reproduces today's بدء التجهيز (new/received/payreview →
-- preparing). Ownership is checked explicitly (the seller has no direct write to
-- order_seller_groups). Blocked once the order is past preparation.
create or replace function public.seller_accept_group(p_order_no text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; g public.order_seller_groups%rowtype;
begin
  select * into o from public.orders where order_no = p_order_no;
  if not found then raise exception 'order not found'; end if;

  select * into g from public.order_seller_groups
   where order_id = o.id and seller_id = auth.uid();
  if not found then raise exception 'no seller group for caller on this order'; end if;

  if public.order_status_rank(o.status) > 1 then
    raise exception 'order is past preparation';
  end if;
  if g.seller_decision = 'rejected' then
    raise exception 'this slice was already rejected';
  end if;

  update public.order_seller_groups
     set seller_decision = 'accepted',
         decided_at      = coalesce(decided_at, now())
   where id = g.id;

  perform public.recompute_order_status_from_groups(o.id);
end $$;
revoke all on function public.seller_accept_group(text) from public, anon;
grant  execute on function public.seller_accept_group(text) to authenticated;

-- ── 3. seller_reject_group — the seller declines their slice (pre-hub only) ──
-- Rule #2: allowed ONLY while the seller's group is still 'paid_by_customer' (before
-- the seller declares the goods en route to the hub). Once pending_hub_delivery or
-- later, rejection is refused. On reject it:
--   • records seller_decision='rejected' + the reason on the group;
--   • computes the MANUAL-refund flag (never auto-refunds): amount owed back to the
--     customer = this seller's goods subtotal + the delivery-fee difference once the
--     fee is recomputed for the remaining live sellers (fee only ever drops);
--   • re-derives orders.status — the order CONTINUES with the remaining sellers, and
--     is only cancelled ('rejected') when every seller has rejected;
--   • mirrors reject_reason onto the order in that all-rejected case (byte-identical
--     to today's whole-order reject);
--   • notifies the customer (rule #4).
create or replace function public.seller_reject_group(p_order_no text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  o                  public.orders%rowtype;
  g                  public.order_seller_groups%rowtype;
  v_remaining_sellers int;
  v_old_fee          int;
  v_new_fee          int;
  v_fee_diff         int;
  v_new_status       text;
begin
  select * into o from public.orders where order_no = p_order_no;
  if not found then raise exception 'order not found'; end if;

  select * into g from public.order_seller_groups
   where order_id = o.id and seller_id = auth.uid();
  if not found then raise exception 'no seller group for caller on this order'; end if;

  -- Rule #2: reject only BEFORE the goods head to the hub.
  if g.fulfillment_status <> 'paid_by_customer' then
    raise exception 'goods already sent to the hub; this slice can no longer be rejected';
  end if;
  if public.order_status_rank(o.status) > 1 then
    raise exception 'order is past preparation';
  end if;

  -- Distinct sellers still live AFTER this rejection (drives the recomputed fee).
  select count(distinct seller_id)
    into v_remaining_sellers
    from public.order_seller_groups
   where order_id = o.id
     and id <> g.id
     and seller_decision <> 'rejected';

  v_old_fee  := coalesce(o.delivery_fee, 0);
  v_new_fee  := public.lozi_delivery_fee(coalesce(v_remaining_sellers, 0));
  v_fee_diff := greatest(v_old_fee - v_new_fee, 0);

  update public.order_seller_groups
     set seller_decision          = 'rejected',
         decided_at               = now(),
         decline_reason           = p_reason,
         refund_rejected_subtotal = coalesce(g.subtotal_amount, 0),
         refund_fee_diff          = v_fee_diff,
         refund_owed_yer          = coalesce(g.subtotal_amount, 0) + v_fee_diff,
         refund_status            = 'pending'
   where id = g.id;

  perform public.recompute_order_status_from_groups(o.id);

  -- Byte-identical mirror: an all-rejected order carries the seller's reason at the
  -- order level, exactly as today's rejectSellerOrder wrote orders.reject_reason.
  select status into v_new_status from public.orders where id = o.id;
  if v_new_status = 'rejected' then
    update public.orders set reject_reason = p_reason where id = o.id;
  end if;

  -- Rule #4: the customer can see a seller declined their slice.
  perform public.notify_order_event(o.customer_id, o.order_no, 'seller_rejected', p_reason);
end $$;
revoke all on function public.seller_reject_group(text, text) from public, anon;
grant  execute on function public.seller_reject_group(text, text) to authenticated;

-- ── 4. notify_order_event — additive 'seller_rejected' case ─────────────────
-- Identical to 20260708 except for the new case; all existing branches preserved.
create or replace function public.notify_order_event(
  p_customer uuid, p_order_no text, p_event text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_title text; v_body text; v_type text := 'order_status';
begin
  if p_customer is null then return; end if;
  case p_event
    when 'preparing' then
      v_title := 'طلبك قيد التجهيز';
      v_body  := 'طلبك رقم #' || p_order_no || ' قيد التجهيز الآن.';
    when 'delivering' then
      v_title := 'طلبك في الطريق 🚚';
      v_body  := 'طلبك رقم #' || p_order_no || ' خرج للتوصيل وهو في طريقه إليك.';
    when 'delivered' then
      v_title := 'تم تسليم طلبك ✓';
      v_body  := 'تم تسليم طلبك رقم #' || p_order_no || '. شكراً لثقتك بلوزي.';
    when 'cancelled' then
      v_title := 'تم إلغاء الطلب';
      v_body  := 'نأسف، تم إلغاء طلبك رقم #' || p_order_no || '.';
    when 'seller_rejected' then
      v_type  := 'seller_rejected';
      v_title := 'تعذّر تجهيز جزء من طلبك';
      v_body  := 'اعتذر أحد الباعة عن تجهيز نصيبه من طلبك رقم #' || p_order_no
                 || coalesce('. السبب: ' || nullif(p_reason, ''), '')
                 || '. سيتم إكمال بقية الطلب ورد المبلغ المستحق.';
    when 'payment_rejected' then
      v_type  := 'payment_rejected';
      v_title := 'رُفض إثبات الدفع';
      v_body  := 'تم رفض إيصال الدفع لطلبك رقم #' || p_order_no
                 || coalesce('. السبب: ' || nullif(p_reason, ''), '')
                 || '. يرجى إرسال إيصال دفع جديد.';
    else
      v_title := 'تحديث على طلبك';
      v_body  := 'تم تحديث حالة طلبك رقم #' || p_order_no || '.';
  end case;

  insert into public.notifications (user_id, type, title, body, meta)
  values (p_customer, v_type, v_title, v_body,
          jsonb_build_object('order_no', p_order_no, 'event', p_event));
end;
$$;
revoke all on function public.notify_order_event(uuid, text, text, text) from public, anon, authenticated;

-- ── 5. Customer-facing view — ignore seller-rejected groups in the aggregate ─
-- Identical to 20260718 except the lateral now also excludes seller_decision =
-- 'rejected', so a partially-rejected multi-seller order is no longer held back by
-- the declined slice. Single-seller behavior is unchanged: an all-rejected order is
-- short-circuited by the `o.status = 'rejected'` branch before the aggregate is read.
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
      and g.seller_decision is distinct from 'rejected'
) agg on true
where o.customer_id = auth.uid() or is_admin();
