-- RFQ follow-ups: (1) expose rfq_offer_id in admin_conversations so admins can
-- identify/monitor pre-order chats; (2) offer acceptance closes the request when
-- every requested item is covered by an accepted offer (partial offers stay open).
-- Applied to project niloddwnllhsvrmuxfxw.

-- 1. Admin conversations view — append rfq_offer_id (preserve security_invoker).
create or replace view public.admin_conversations with (security_invoker = true) as
  select c.id,
         c.participant_a,
         c.participant_b,
         c.order_id,
         c.created_at,
         c.last_message_at,
         c.last_message_preview,
         c.flagged,
         c.flagged_count,
         pa.name as participant_a_name,
         pa.role as participant_a_role,
         pb.name as participant_b_name,
         pb.role as participant_b_role,
         o.order_no,
         c.rfq_offer_id
    from public.conversations c
    left join public.profiles pa on pa.user_id = c.participant_a
    left join public.profiles pb on pb.user_id = c.participant_b
    left join public.orders o on o.id = c.order_id
   where public.is_admin();

-- 2. rfq_accept_offer — mark accepted, then close the request iff fully covered.
create or replace function public.rfq_accept_offer(p_offer_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_buyer uuid;
  v_req   uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select r.buyer_id, r.id into v_buyer, v_req
  from public.rfq_offers o join public.rfq_requests r on r.id = o.request_id
  where o.id = p_offer_id;
  if v_buyer is null then raise exception 'offer not found'; end if;
  if v_buyer <> v_uid then raise exception 'only the request owner can accept'; end if;

  update public.rfq_offers set status = 'accepted', updated_at = now() where id = p_offer_id;

  -- Close the request only when every requested item is now covered by an
  -- accepted offer item (partial offers leave the request open for other offers).
  update public.rfq_requests r set status = 'closed'
   where r.id = v_req and r.status = 'open'
     and not exists (
       select 1 from public.rfq_request_items ri
       where ri.request_id = v_req
         and not exists (
           select 1 from public.rfq_offer_items oi
           join public.rfq_offers o on o.id = oi.offer_id
           where o.request_id = v_req and o.status = 'accepted' and oi.request_item_id = ri.id
         )
     );
end;
$$;
revoke all on function public.rfq_accept_offer(uuid) from public, anon;
grant execute on function public.rfq_accept_offer(uuid) to authenticated;
