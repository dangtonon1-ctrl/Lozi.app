-- RFQ System — Phase 4: number-leak detection, access gate, admin flags,
-- request-item photos. Applied to project niloddwnllhsvrmuxfxw.
--
-- Notes:
--  * Number leaks in RFQ free-text (request notes / offer descriptions) are MASKED
--    (the offending field is dropped) + the sender gets a three-strikes penalty and an
--    admin alert. We mask rather than hard-reject because raising an exception in the
--    same transaction would roll back the strike too.
--  * Access gate is centralized in rfq_can_browse(): open for 6 months from the
--    settings key `rfq_launch_date` (unset = always open), then Retail Level 5+ only.

-- ---------------------------------------------------------------------------
-- Request-item photos (optional per item)
-- ---------------------------------------------------------------------------
alter table public.rfq_request_items add column if not exists image_url text;

-- ---------------------------------------------------------------------------
-- Number-leak detection: numeric (incl Arabic-Indic) + Arabic word-spelled
-- ---------------------------------------------------------------------------
create or replace function public.rfq_detect_number(p_text text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  v_digits text;
  v_words  text;
begin
  if p_text is null or length(btrim(p_text)) = 0 then return false; end if;
  -- (a) numeric leak: normalize digits (Arabic-Indic -> Latin, strip non-digits)
  v_digits := public.chat_normalize_digits(p_text);
  if v_digits ~ '7[7318][0-9]{7}' or v_digits ~ '[0-9]{7,}' then
    return true;
  end if;
  -- (b) Arabic word-spelled numbers -> digits, then look for a long run
  v_words := lower(p_text);
  v_words := regexp_replace(v_words, 'صفر', '0', 'g');
  v_words := regexp_replace(v_words, 'واحد[ةه]?', '1', 'g');
  v_words := regexp_replace(v_words, 'اثن(ان|ين|تان|تين)|إثن(ان|ين)|اتنين', '2', 'g');
  v_words := regexp_replace(v_words, 'ثلاث[ةه]?', '3', 'g');
  v_words := regexp_replace(v_words, '[اأإ]ربع[ةه]?', '4', 'g');
  v_words := regexp_replace(v_words, 'خمس[ةه]?', '5', 'g');
  v_words := regexp_replace(v_words, 'ست[ةه]?', '6', 'g');
  v_words := regexp_replace(v_words, 'سبع[ةه]?', '7', 'g');
  v_words := regexp_replace(v_words, 'ثماني[ةه]?|ثمان', '8', 'g');
  v_words := regexp_replace(v_words, 'تسع[ةه]?', '9', 'g');
  v_words := regexp_replace(v_words, '[^0-9]', '', 'g');
  if v_words ~ '[0-9]{7,}' then return true; end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin flag alerts for RFQ text leaks (mirror of chat_flag_alerts)
-- ---------------------------------------------------------------------------
create table if not exists public.rfq_flag_alerts (
  id         uuid        primary key default gen_random_uuid(),
  source     text        not null check (source in ('request_note','offer_desc')),
  user_id    uuid,
  excerpt    text,
  reasons    text[]      not null default '{}',
  seen       boolean     not null default false,
  resolved   boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rfq_flag_alerts_unresolved_idx on public.rfq_flag_alerts (resolved, created_at desc);
alter table public.rfq_flag_alerts enable row level security;

drop policy if exists rfq_flag_alerts_admin_read on public.rfq_flag_alerts;
create policy rfq_flag_alerts_admin_read on public.rfq_flag_alerts for select using (public.is_admin());
drop policy if exists rfq_flag_alerts_admin_update on public.rfq_flag_alerts;
create policy rfq_flag_alerts_admin_update on public.rfq_flag_alerts for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists rfq_flag_alerts_admin_delete on public.rfq_flag_alerts;
create policy rfq_flag_alerts_admin_delete on public.rfq_flag_alerts for delete using (public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.rfq_flag_alerts;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Flag + three-strikes penalty (mirror of messages_after_insert strike logic)
-- ---------------------------------------------------------------------------
create or replace function public.rfq_flag_and_strike(p_user uuid, p_source text, p_excerpt text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role   text;
  v_status text;
  v_wc     integer;
begin
  insert into public.rfq_flag_alerts (source, user_id, excerpt, reasons)
  values (p_source, p_user, left(coalesce(p_excerpt,''), 200), array['number']);

  select role, status into v_role, v_status from public.profiles where user_id = p_user;
  if public.is_vendor_role(v_role) then
    update public.profiles set warning_count = warning_count + 1, last_warned_at = now()
      where user_id = p_user returning warning_count, status into v_wc, v_status;
    insert into public.notifications (user_id, type, title, body, meta)
    values (p_user, 'warning', 'تحذير', 'تحذير: مشاركة أرقام التواصل مخالفة لقواعد التطبيق',
            jsonb_build_object('warning_count', v_wc, 'source', p_source));
    if v_wc >= 3 and coalesce(v_status,'active') not in ('suspended','banned','deleted') then
      update public.profiles set status = 'suspended', suspended_reason = 'three_strikes_number_sharing'
        where user_id = p_user;
      insert into public.notifications (user_id, type, title, body, meta)
      values (p_user, 'suspended', 'توقيف الحساب', 'تم توقيف الحساب لكسر القواعد',
              jsonb_build_object('reason', 'three_strikes_number_sharing'));
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- rfq_create — now persists image_url + masks number leaks in item notes
-- ---------------------------------------------------------------------------
create or replace function public.rfq_create(p_city text, p_buyer_role text, p_expires_at timestamptz, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_item jsonb;
  v_note text;
  v_leak boolean := false;
  v_excerpt text;
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
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(v_item->>'product_type'), '') = '' then raise exception 'item product_type required'; end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then raise exception 'item quantity must be greater than zero'; end if;
    v_note := nullif(btrim(v_item->>'note'), '');
    if v_note is not null and public.rfq_detect_number(v_note) then
      v_leak := true; v_excerpt := v_note; v_note := null;
    end if;
    insert into public.rfq_request_items
      (request_id, product_type, category, variety_id, quantity, unit, unit_weight_kg, image_url, note)
    values (
      v_id, btrim(v_item->>'product_type'), nullif(btrim(v_item->>'category'), ''), nullif(btrim(v_item->>'variety_id'), ''),
      (v_item->>'quantity')::numeric, coalesce(nullif(btrim(v_item->>'unit'), ''), 'kg'),
      nullif(btrim(v_item->>'unit_weight_kg'), '')::numeric, nullif(btrim(v_item->>'image_url'), ''), v_note
    );
  end loop;
  if v_leak then perform public.rfq_flag_and_strike(v_uid, 'request_note', v_excerpt); end if;
  return v_id;
end;
$$;
revoke all on function public.rfq_create(text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.rfq_create(text, text, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- rfq_submit_offer — masks number leaks in offer item descriptions
-- ---------------------------------------------------------------------------
create or replace function public.rfq_submit_offer(p_request_id uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_offer uuid;
  v_item  jsonb;
  v_req   record;
  v_ri_ok int;
  v_desc  text;
  v_leak  boolean := false;
  v_excerpt text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.rfq_can_browse() then raise exception 'not eligible to make offers'; end if;
  select id, buyer_id, status, expires_at into v_req from public.rfq_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request not found'; end if;
  if v_req.buyer_id = v_uid then raise exception 'cannot offer on your own request'; end if;
  if v_req.status <> 'open' or v_req.expires_at <= now() then raise exception 'request is not open'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item required';
  end if;
  insert into public.rfq_offers (request_id, seller_id, status, updated_at)
  values (p_request_id, v_uid, 'pending', now())
  on conflict (request_id, seller_id) do update set status = 'pending', updated_at = now()
  returning id into v_offer;
  delete from public.rfq_offer_items where offer_id = v_offer;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_ri_ok := null;
    select 1 into v_ri_ok from public.rfq_request_items where id = (v_item->>'request_item_id')::uuid and request_id = p_request_id;
    if v_ri_ok is null then raise exception 'invalid request_item for this request'; end if;
    if coalesce((v_item->>'price')::numeric, -1) < 0 then raise exception 'invalid price'; end if;
    if coalesce((v_item->>'available_quantity')::numeric, 0) <= 0 then raise exception 'available quantity must be greater than zero'; end if;
    v_desc := nullif(btrim(v_item->>'description'), '');
    if v_desc is not null and public.rfq_detect_number(v_desc) then
      v_leak := true; v_excerpt := v_desc; v_desc := null;
    end if;
    insert into public.rfq_offer_items (offer_id, request_item_id, price, available_quantity, image_url, description)
    values (v_offer, (v_item->>'request_item_id')::uuid, (v_item->>'price')::numeric, (v_item->>'available_quantity')::numeric,
            nullif(btrim(v_item->>'image_url'), ''), v_desc);
  end loop;
  if v_leak then perform public.rfq_flag_and_strike(v_uid, 'offer_desc', v_excerpt); end if;
  return v_offer;
end;
$$;
revoke all on function public.rfq_submit_offer(uuid, jsonb) from public, anon;
grant execute on function public.rfq_submit_offer(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Access gate — extend rfq_can_browse(): open 6 months, then Retail Level 5+
-- ---------------------------------------------------------------------------
create or replace function public.rfq_can_browse() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_vendor     boolean;
  v_launch     text;
  v_launch_dt  date;
  v_level5_min numeric;
  v_sales      numeric;
begin
  select exists (select 1 from public.profiles p
           where p.user_id = auth.uid() and public.is_vendor_role(p.role)
             and coalesce(p.status,'active') not in ('suspended','banned','deleted'))
     and exists (select 1 from public.vendor_verifications v
           where v.user_id = auth.uid() and v.status = 'approved')
    into v_vendor;
  if not v_vendor then return false; end if;

  select trim(both '"' from value) into v_launch from public.settings where key = 'rfq_launch_date';
  if v_launch is null or v_launch = '' then return true; end if;
  begin v_launch_dt := v_launch::date; exception when others then return true; end;
  if now() < (v_launch_dt + interval '6 months') then return true; end if;

  select min_sales into v_level5_min from public.commission_tiers where segment = 'retail' and level = 5;
  select retail_cumulative_sales into v_sales from public.profiles where user_id = auth.uid();
  return coalesce(v_sales, 0) >= coalesce(v_level5_min, 500000);
end;
$$;

-- Client-facing access status (for the gate message / countdown)
create or replace function public.rfq_access_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_launch text; v_launch_dt date; v_gate_end timestamptz; v_open boolean; v_days int;
begin
  select trim(both '"' from value) into v_launch from public.settings where key = 'rfq_launch_date';
  if v_launch is null or v_launch = '' then
    return jsonb_build_object('launch_date', null, 'open', true, 'gate_active', false, 'days_left', null, 'eligible', public.rfq_can_browse());
  end if;
  begin v_launch_dt := v_launch::date; exception when others then
    return jsonb_build_object('launch_date', null, 'open', true, 'gate_active', false, 'days_left', null, 'eligible', public.rfq_can_browse());
  end;
  v_gate_end := v_launch_dt + interval '6 months';
  v_open := now() < v_gate_end;
  v_days := greatest(0, ceil(extract(epoch from (v_gate_end - now())) / 86400))::int;
  return jsonb_build_object('launch_date', v_launch_dt, 'open', v_open, 'gate_active', not v_open, 'days_left', v_days, 'eligible', public.rfq_can_browse());
end;
$$;
revoke all on function public.rfq_access_status() from public, anon;
grant execute on function public.rfq_access_status() to authenticated;
