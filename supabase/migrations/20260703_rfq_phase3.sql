-- RFQ System — Phase 3: buyer views ranked offers, chats per seller, accepts.
--
-- Applied to project niloddwnllhsvrmuxfxw.
--
-- Adds: (1) unit_weight_kg on request items (for the قدح / قدح-weight and رطل units);
-- (2) rfq_accept_offer RPC (request owner marks an offer accepted);
-- (3) per-offer chat threads by extending the existing conversations table with an
--     rfq_offer_id context + a mirrored find_or_create_rfq_conversation RPC.
-- Buyers can already READ offers/items on their requests (Phase 2 RLS) and rank them
-- client-side (lowest total first).

-- ---------------------------------------------------------------------------
-- 1. Optional per-item unit weight (kg) — used by the قدح unit (32/33/34/35)
-- ---------------------------------------------------------------------------
alter table public.rfq_request_items add column if not exists unit_weight_kg numeric;

-- rfq_create: same signature; now also persists unit_weight_kg from each item.
create or replace function public.rfq_create(
  p_city       text,
  p_buyer_role text,
  p_expires_at timestamptz,
  p_items      jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_item jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'city required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'expiry must be in the future'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item required';
  end if;

  insert into public.rfq_requests (buyer_id, buyer_role, city, expires_at)
  values (v_uid, coalesce(nullif(btrim(p_buyer_role), ''), 'customer'), btrim(p_city), p_expires_at)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(btrim(v_item->>'product_type'), '') = '' then raise exception 'item product_type required'; end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then raise exception 'item quantity must be greater than zero'; end if;

    insert into public.rfq_request_items
      (request_id, product_type, category, variety_id, quantity, unit, unit_weight_kg, note)
    values (
      v_id,
      btrim(v_item->>'product_type'),
      nullif(btrim(v_item->>'category'), ''),
      nullif(btrim(v_item->>'variety_id'), ''),
      (v_item->>'quantity')::numeric,
      coalesce(nullif(btrim(v_item->>'unit'), ''), 'kg'),
      nullif(btrim(v_item->>'unit_weight_kg'), '')::numeric,
      nullif(btrim(v_item->>'note'), '')
    );
  end loop;

  return v_id;
end;
$$;
revoke all on function public.rfq_create(text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.rfq_create(text, text, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Accept an offer (only the request's buyer). Marks accepted; continues in chat.
-- ---------------------------------------------------------------------------
create or replace function public.rfq_accept_offer(p_offer_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_buyer uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select r.buyer_id into v_buyer
  from public.rfq_offers o join public.rfq_requests r on r.id = o.request_id
  where o.id = p_offer_id;
  if v_buyer is null then raise exception 'offer not found'; end if;
  if v_buyer <> v_uid then raise exception 'only the request owner can accept'; end if;
  update public.rfq_offers set status = 'accepted', updated_at = now() where id = p_offer_id;
end;
$$;
revoke all on function public.rfq_accept_offer(uuid) from public, anon;
grant execute on function public.rfq_accept_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-offer chat threads — extend conversations with an rfq_offer_id context.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists rfq_offer_id uuid references public.rfq_offers (id) on delete set null;
create index if not exists conversations_rfq_offer_idx on public.conversations (rfq_offer_id);

-- Widen the pair-uniqueness to include rfq_offer_id so each offer gets its own thread
-- (existing order-based threads keep working: rfq_offer_id is NULL for them).
drop index if exists public.conversations_pair_order_uniq;
create unique index conversations_pair_order_uniq on public.conversations
  (participant_a, participant_b,
   coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(rfq_offer_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Mirror of find_or_create_conversation, keyed on rfq_offer_id instead of order_id.
create or replace function public.find_or_create_rfq_conversation(p_other uuid, p_offer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a  uuid;
  v_b  uuid;
  v_id uuid;
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.chat_can_message(v_me, p_other) then
    raise exception 'messaging not allowed for this pair';
  end if;
  if v_me < p_other then v_a := v_me; v_b := p_other;
  else                   v_a := p_other; v_b := v_me; end if;
  select id into v_id from public.conversations
   where participant_a = v_a and participant_b = v_b
     and coalesce(order_id, v_sentinel) = v_sentinel
     and coalesce(rfq_offer_id, v_sentinel) = coalesce(p_offer, v_sentinel)
   limit 1;
  if v_id is not null then return v_id; end if;
  begin
    insert into public.conversations (participant_a, participant_b, rfq_offer_id)
    values (v_a, v_b, p_offer)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations
     where participant_a = v_a and participant_b = v_b
       and coalesce(order_id, v_sentinel) = v_sentinel
       and coalesce(rfq_offer_id, v_sentinel) = coalesce(p_offer, v_sentinel)
     limit 1;
  end;
  return v_id;
end;
$$;
revoke all on function public.find_or_create_rfq_conversation(uuid, uuid) from public, anon;
grant execute on function public.find_or_create_rfq_conversation(uuid, uuid) to authenticated;
