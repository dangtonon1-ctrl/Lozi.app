-- ════════════════════════════════════════════════════════════════════════════
-- Order lifecycle state machine (backend-enforced) + customer cancellation
-- eligibility + customer notifications.
--
-- Canonical progression (forward, one step at a time, admin-triggered):
--   Pending Review  →  In Preparation  →  Out for Delivery  →  Completed
--   (new/received/     (preparing)         (delivering)         (delivered)
--    payreview)
--
-- Cancelled (terminal): reachable ONLY from Pending Review or In Preparation.
--   Blocked once the order reaches Out for Delivery / Completed.
--
-- Rules enforced here (not just in the UI):
--   • Forward  : admin only, exactly one rank at a time.
--   • Backward : admin only, any number of ranks down, SILENT (no notification).
--   • Cancel   : admin (any pre-delivery order) or the customer (their own order,
--                up to & including In Preparation). Blocked at Out for Delivery+.
--   • Reject payment: sends the order back to Pending Review awaiting a fresh
--                receipt (NOT a cancellation) and notifies the customer.
--   • Forward transitions & cancellation push a customer notification; backward
--     transitions never do.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Progression rank ─────────────────────────────────────────────────────
-- Position of a status inside the forward chain. The three "pre-preparation"
-- statuses (new / received / payreview) collapse into a single Pending-Review
-- rank (0). Terminal / non-progression statuses return -1.
create or replace function public.order_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'new'        then 0
    when 'received'   then 0
    when 'payreview'  then 0
    when 'preparing'  then 1
    when 'delivering' then 2
    when 'delivered'  then 3
    else -1
  end;
$$;

-- ── 2. Customer notification builder ────────────────────────────────────────
-- SECURITY DEFINER so it can write to notifications (which has no INSERT policy
-- for regular clients). Builds an Arabic title/body for each lifecycle event.
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

-- ── 3. Admin lifecycle transition ───────────────────────────────────────────
-- The single authoritative entry-point for admin-driven status changes.
-- Validates the transition, keeps commission accounting consistent, and fires
-- the right notification (or stays silent for backward moves).
create or replace function public.admin_set_order_status(p_order_no text, p_new_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  o          public.orders%rowtype;
  v_cur_rank int;
  v_new_rank int;
  v_dir      text;   -- 'forward' | 'backward' | 'cancel'
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  select * into o from public.orders where order_no = p_order_no;
  if not found then raise exception 'order % not found', p_order_no; end if;

  v_cur_rank := public.order_status_rank(o.status);

  if p_new_status = 'cancelled' then
    -- Cancel only from Pending Review (0) or In Preparation (1).
    if v_cur_rank not in (0, 1) then
      raise exception 'order cannot be cancelled once it is out for delivery';
    end if;
    v_dir := 'cancel';
  else
    v_new_rank := public.order_status_rank(p_new_status);
    if v_new_rank < 0 then raise exception 'invalid target status %', p_new_status; end if;
    if v_cur_rank < 0 then raise exception 'order is in a terminal state'; end if;

    if v_new_rank = v_cur_rank + 1 then
      v_dir := 'forward';
    elsif v_new_rank = v_cur_rank then
      return;                                   -- idempotent no-op
    elsif v_new_rank < v_cur_rank then
      v_dir := 'backward';
    else
      raise exception 'forward progression must be one step at a time';
    end if;
  end if;

  -- Leaving a Completed order backwards must un-charge its commission so the
  -- seller's cumulative sales stay correct (reverse_commission is self-guarded).
  if v_dir = 'backward' and o.status = 'delivered' and o.commission_state = 'charged' then
    perform public.reverse_commission(o.id, null);
  end if;

  update public.orders set status = p_new_status where order_no = p_order_no;

  -- Forward steps & cancellation notify the customer; backward moves are silent.
  if v_dir in ('forward', 'cancel') then
    perform public.notify_order_event(o.customer_id, p_order_no, p_new_status);
  end if;
end;
$$;
revoke all on function public.admin_set_order_status(text, text) from public, anon;
grant  execute on function public.admin_set_order_status(text, text) to authenticated;

-- ── 4. Admin reject payment ─────────────────────────────────────────────────
-- Sends the order back to Pending Review awaiting a new receipt (does NOT
-- cancel it), records the reason, and pushes an immediate notification.
create or replace function public.admin_reject_payment(p_order_no text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a rejection reason is required'; end if;

  select * into o from public.orders where order_no = p_order_no;
  if not found then raise exception 'order % not found', p_order_no; end if;

  update public.orders
     set pay_status    = 'rejected',
         reject_reason = p_reason,
         -- back to the cart-equivalent Pending-Review state (unless already
         -- further along than delivery, which we never rewind here)
         status        = case when public.order_status_rank(status) between 0 and 1
                              then 'payreview' else status end
   where order_no = p_order_no;

  perform public.notify_order_event(o.customer_id, p_order_no, 'payment_rejected', p_reason);
end;
$$;
revoke all on function public.admin_reject_payment(text, text) from public, anon;
grant  execute on function public.admin_reject_payment(text, text) to authenticated;

-- ── 5. Customer self-cancellation ───────────────────────────────────────────
-- A customer may cancel their OWN order up to & including In Preparation. Once
-- it is Out for Delivery the cancellation is blocked. Transitions to the tracked
-- 'cancelled' terminal state (so the admin still sees it) rather than deleting.
create or replace function public.customer_cancel_order(p_order_no text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders
    where order_no = p_order_no and customer_id = auth.uid();
  if not found then raise exception 'order not found'; end if;

  if public.order_status_rank(o.status) not in (0, 1) then
    raise exception 'order can no longer be cancelled';
  end if;

  update public.orders set status = 'cancelled' where order_no = p_order_no;
end;
$$;
revoke all on function public.customer_cancel_order(text) from public, anon;
grant  execute on function public.customer_cancel_order(text) to authenticated;

-- ── 6. Harden the customer DELETE policy ────────────────────────────────────
-- Defense in depth: even a hand-rolled delete cannot drop an order that is
-- already Out for Delivery or later.
drop policy if exists orders_customer_delete on public.orders;
create policy orders_customer_delete on public.orders for delete
  using (auth.uid() = customer_id and public.order_status_rank(status) in (0, 1));
