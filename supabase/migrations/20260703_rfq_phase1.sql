-- RFQ System — Phase 1: buyer price requests (طلب سعر / الطلب المسبق).
--
-- Lets a buyer (any role: customer / retail / wholesale / farmer_*) post a request
-- containing MULTIPLE items (e.g. "20kg Jabri almonds" + "15kg Razqi raisins"), one
-- city for the whole request, and an expiry the buyer sets. Sellers/offers come in
-- Phase 2 — for now RLS restricts everything to the owning buyer (+ admin oversight).
--
-- Applied to project niloddwnllhsvrmuxfxw.
--
-- Notes:
--  * UUID PKs (gen_random_uuid) so Phase 3 can attach an rfq_offer_id FK to conversations.
--  * buyer_role is captured at creation as the RAW app role (lossless); the 3 seller
--    tabs (customer/retail/wholesale) are a Phase-2 display concern.
--  * category / variety_id are optional and align with public.section_varieties for
--    future filtering; the human-readable product_type is the required descriptor.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.rfq_requests (
  id         uuid        primary key default gen_random_uuid(),
  buyer_id   uuid        not null references auth.users (id) on delete cascade,
  buyer_role text        not null,
  city       text        not null,
  status     text        not null default 'open' check (status in ('open','closed','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists rfq_requests_buyer_idx  on public.rfq_requests (buyer_id);
create index if not exists rfq_requests_status_idx on public.rfq_requests (status, expires_at);

create table if not exists public.rfq_request_items (
  id           uuid          primary key default gen_random_uuid(),
  request_id   uuid          not null references public.rfq_requests (id) on delete cascade,
  product_type text          not null,
  category     text,
  variety_id   text,
  quantity     numeric(14,2) not null check (quantity > 0),
  unit         text          not null default 'kg',
  note         text,
  created_at   timestamptz   not null default now()
);

create index if not exists rfq_request_items_request_idx on public.rfq_request_items (request_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.rfq_requests      enable row level security;
alter table public.rfq_request_items enable row level security;

-- rfq_requests: a buyer manages only their own requests; admins may read all.
drop policy if exists rfq_requests_select_own on public.rfq_requests;
create policy rfq_requests_select_own on public.rfq_requests
  for select using (auth.uid() = buyer_id or public.is_admin());

drop policy if exists rfq_requests_insert_own on public.rfq_requests;
create policy rfq_requests_insert_own on public.rfq_requests
  for insert with check (auth.uid() = buyer_id);

drop policy if exists rfq_requests_update_own on public.rfq_requests;
create policy rfq_requests_update_own on public.rfq_requests
  for update using (auth.uid() = buyer_id) with check (auth.uid() = buyer_id);

-- rfq_request_items: scoped through the parent request's ownership.
drop policy if exists rfq_request_items_select on public.rfq_request_items;
create policy rfq_request_items_select on public.rfq_request_items
  for select using (
    exists (
      select 1 from public.rfq_requests r
      where r.id = request_id and (r.buyer_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists rfq_request_items_insert on public.rfq_request_items;
create policy rfq_request_items_insert on public.rfq_request_items
  for insert with check (
    exists (
      select 1 from public.rfq_requests r
      where r.id = request_id and r.buyer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Atomic create RPC — inserts the request + all items in one transaction.
-- Mirrors the find_or_create_conversation precedent (security definer + hardened grants).
-- p_items: jsonb array of { product_type, quantity, unit, category?, variety_id?, note? }
-- ---------------------------------------------------------------------------
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
  v_count int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_city is null or length(btrim(p_city)) = 0 then
    raise exception 'city required';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'expiry must be in the future';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item required';
  end if;

  insert into public.rfq_requests (buyer_id, buyer_role, city, expires_at)
  values (v_uid, coalesce(nullif(btrim(p_buyer_role), ''), 'customer'), btrim(p_city), p_expires_at)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(btrim(v_item->>'product_type'), '') = '' then
      raise exception 'item product_type required';
    end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then
      raise exception 'item quantity must be greater than zero';
    end if;

    insert into public.rfq_request_items
      (request_id, product_type, category, variety_id, quantity, unit, note)
    values (
      v_id,
      btrim(v_item->>'product_type'),
      nullif(btrim(v_item->>'category'), ''),
      nullif(btrim(v_item->>'variety_id'), ''),
      (v_item->>'quantity')::numeric,
      coalesce(nullif(btrim(v_item->>'unit'), ''), 'kg'),
      nullif(btrim(v_item->>'note'), '')
    );
    v_count := v_count + 1;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.rfq_create(text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.rfq_create(text, text, timestamptz, jsonb) to authenticated;
