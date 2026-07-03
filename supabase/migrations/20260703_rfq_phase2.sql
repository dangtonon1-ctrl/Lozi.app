-- RFQ System — Phase 2: seller offers on buyer price requests.
--
-- Verified sellers browse OPEN requests (3 tabs by buyer_role) and submit offers,
-- responding to all or only some items (partial offers): price + available quantity
-- + optional image + description per item. One editable offer per seller per request.
--
-- Applied to project niloddwnllhsvrmuxfxw.
--
-- Access model: browse/offer eligibility is centralized in public.rfq_can_browse()
-- (verified, non-suspended vendor). Phase 4 will AND the time-then-Retail-Level-5
-- gate into THAT ONE function, so no policy here changes again.

-- ---------------------------------------------------------------------------
-- Eligibility helper (verified vendor, not suspended). Phase 4 extends this.
-- ---------------------------------------------------------------------------
create or replace function public.rfq_can_browse() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public.profiles p
           where p.user_id = auth.uid()
             and public.is_vendor_role(p.role)
             and coalesce(p.status,'active') not in ('suspended','banned','deleted')
         )
     and exists (
           select 1 from public.vendor_verifications v
           where v.user_id = auth.uid() and v.status = 'approved'
         );
$$;
revoke all on function public.rfq_can_browse() from public, anon;
grant execute on function public.rfq_can_browse() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.rfq_offers (
  id         uuid        primary key default gen_random_uuid(),
  request_id uuid        not null references public.rfq_requests (id) on delete cascade,
  seller_id  uuid        not null references auth.users (id) on delete cascade,
  status     text        not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, seller_id)
);
create index if not exists rfq_offers_request_idx on public.rfq_offers (request_id);
create index if not exists rfq_offers_seller_idx  on public.rfq_offers (seller_id);

create table if not exists public.rfq_offer_items (
  id                 uuid          primary key default gen_random_uuid(),
  offer_id           uuid          not null references public.rfq_offers (id) on delete cascade,
  request_item_id    uuid          not null references public.rfq_request_items (id) on delete cascade,
  price              numeric(14,2) not null check (price >= 0),
  available_quantity numeric(14,2) not null check (available_quantity > 0),
  image_url          text,
  description        text,
  created_at         timestamptz   not null default now()
);
create index if not exists rfq_offer_items_offer_idx on public.rfq_offer_items (offer_id);
create index if not exists rfq_offer_items_reqitem_idx on public.rfq_offer_items (request_item_id);

alter table public.rfq_offers      enable row level security;
alter table public.rfq_offer_items enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — extend request/item read for eligible sellers (open requests only)
-- ---------------------------------------------------------------------------
drop policy if exists rfq_requests_seller_browse on public.rfq_requests;
create policy rfq_requests_seller_browse on public.rfq_requests
  for select using (status = 'open' and public.rfq_can_browse());

drop policy if exists rfq_request_items_seller_browse on public.rfq_request_items;
create policy rfq_request_items_seller_browse on public.rfq_request_items
  for select using (
    exists (
      select 1 from public.rfq_requests r
      where r.id = request_id and r.status = 'open' and public.rfq_can_browse()
    )
  );

-- rfq_offers: seller reads own; admin all; request owner (buyer) reads offers on
-- their request (forward-compat for Phase 3). Seller inserts/updates own only.
drop policy if exists rfq_offers_select on public.rfq_offers;
create policy rfq_offers_select on public.rfq_offers
  for select using (
    seller_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.rfq_requests r where r.id = request_id and r.buyer_id = auth.uid())
  );

drop policy if exists rfq_offers_insert on public.rfq_offers;
create policy rfq_offers_insert on public.rfq_offers
  for insert with check (seller_id = auth.uid() and public.rfq_can_browse());

drop policy if exists rfq_offers_update_own on public.rfq_offers;
create policy rfq_offers_update_own on public.rfq_offers
  for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- rfq_offer_items: scoped through the parent offer's visibility/ownership.
drop policy if exists rfq_offer_items_select on public.rfq_offer_items;
create policy rfq_offer_items_select on public.rfq_offer_items
  for select using (
    exists (
      select 1 from public.rfq_offers o
      where o.id = offer_id
        and (
          o.seller_id = auth.uid()
          or public.is_admin()
          or exists (select 1 from public.rfq_requests r where r.id = o.request_id and r.buyer_id = auth.uid())
        )
    )
  );

drop policy if exists rfq_offer_items_insert on public.rfq_offer_items;
create policy rfq_offer_items_insert on public.rfq_offer_items
  for insert with check (
    exists (select 1 from public.rfq_offers o where o.id = offer_id and o.seller_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Atomic submit/replace RPC — one offer per (request, seller), items replaced.
-- p_items: jsonb array of
--   { request_item_id, price, available_quantity, image_url?, description? }
-- ---------------------------------------------------------------------------
create or replace function public.rfq_submit_offer(p_request_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_offer uuid;
  v_item  jsonb;
  v_req   record;
  v_ri_ok int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.rfq_can_browse() then
    raise exception 'not eligible to make offers';
  end if;

  select id, buyer_id, status, expires_at into v_req
  from public.rfq_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'request not found';
  end if;
  if v_req.buyer_id = v_uid then
    raise exception 'cannot offer on your own request';
  end if;
  if v_req.status <> 'open' or v_req.expires_at <= now() then
    raise exception 'request is not open';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item required';
  end if;

  insert into public.rfq_offers (request_id, seller_id, status, updated_at)
  values (p_request_id, v_uid, 'pending', now())
  on conflict (request_id, seller_id)
  do update set status = 'pending', updated_at = now()
  returning id into v_offer;

  delete from public.rfq_offer_items where offer_id = v_offer;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_ri_ok := null;
    select 1 into v_ri_ok from public.rfq_request_items
      where id = (v_item->>'request_item_id')::uuid and request_id = p_request_id;
    if v_ri_ok is null then
      raise exception 'invalid request_item for this request';
    end if;
    if coalesce((v_item->>'price')::numeric, -1) < 0 then
      raise exception 'invalid price';
    end if;
    if coalesce((v_item->>'available_quantity')::numeric, 0) <= 0 then
      raise exception 'available quantity must be greater than zero';
    end if;

    insert into public.rfq_offer_items
      (offer_id, request_item_id, price, available_quantity, image_url, description)
    values (
      v_offer,
      (v_item->>'request_item_id')::uuid,
      (v_item->>'price')::numeric,
      (v_item->>'available_quantity')::numeric,
      nullif(btrim(v_item->>'image_url'), ''),
      nullif(btrim(v_item->>'description'), '')
    );
  end loop;

  return v_offer;
end;
$$;
revoke all on function public.rfq_submit_offer(uuid, jsonb) from public, anon;
grant execute on function public.rfq_submit_offer(uuid, jsonb) to authenticated;
