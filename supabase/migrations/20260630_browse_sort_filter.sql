-- ============================================================================
-- Lozi — Server-side sorting & filtering for stores and products.
-- Applied to project niloddwnllhsvrmuxfxw on 2026-06-30. Idempotent.
--
-- The composite "الأنسب" (best) ordering and every filter live HERE, in one
-- place, so the ranking can be tuned later without touching the client. The
-- client calls browse_products / browse_stores (PostgREST RPC) and renders
-- the rows in the order the database returns them — it never fetches the whole
-- catalog to sort/filter on the client.
-- ============================================================================

-- ── 1. Store flags reused by the filters (add only what's missing) ──────────
-- `offers` holds the retail offer JSON the client already expects:
--   { discount:{percent,scope,productId}, bundle:{...}, freeDelivery:bool }
-- `free_delivery` is a simple store-level toggle (also honoured via offers).
alter table public.stores
  add column if not exists offers        jsonb,
  add column if not exists free_delivery boolean not null default false;

-- ── 2. Data-driven varieties per section (almonds ≠ raisins ≠ …) ────────────
create table if not exists public.section_varieties (
  section    text    not null,          -- products.category: 'almond','raisin',…
  variety_id text    not null,           -- matches products.data->>'variety'
  label_ar   text    not null,
  label_en   text,
  sort       int     not null default 0,
  primary key (section, variety_id)
);
alter table public.section_varieties enable row level security;
drop policy if exists section_varieties_read on public.section_varieties;
create policy section_varieties_read on public.section_varieties for select using (true);
drop policy if exists section_varieties_admin on public.section_varieties;
create policy section_varieties_admin on public.section_varieties for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.section_varieties (section, variety_id, label_ar, label_en, sort) values
  ('almond','jabri',   'جبري',  'Jabri',   1),
  ('almond','khawlani','خولاني','Khawlani',2),
  ('almond','matari',  'مطري',  'Matari',  3),
  ('raisin','ahmar',   'أحمر',  'Red',     1),
  ('raisin','aswad',   'أسود',  'Black',   2),
  ('raisin','akhdar',  'أخضر',  'Green',   3)
on conflict (section, variety_id) do update
  set label_ar = excluded.label_ar, label_en = excluded.label_en, sort = excluded.sort;

-- ── 3. PRODUCT browse: composite "best" + 5 sorts + all filters + paging ────
-- Returns whole product rows (same shape as select * from products) so the
-- client's existing row→product mapping keeps working unchanged.
create or replace function public.browse_products(
  p_section            text    default null,
  p_sort               text    default 'best',   -- best|price_asc|price_desc|rating|newest
  p_varieties          text[]  default null,
  p_price_min          numeric default null,
  p_price_max          numeric default null,
  p_shahti_only        boolean default false,    -- شارة «خالٍ من المرارة»
  p_free_delivery_only boolean default false,    -- توصيل مجاني
  p_bundle_only        boolean default false,    -- عرض مشكّل (retail only, gated client-side)
  p_discount_only      boolean default false,    -- خصم عام (strikethrough pricing)
  p_limit              int     default 60,
  p_offset             int     default 0
) returns setof public.products
language sql stable security definer set search_path = public as $$
  select p.*
  from public.products p
  left join public.stores s on s.vendor_id = p.vendor_id
  where p.status = 'available'
    and coalesce(p.category,'') <> 'savings'
    and (p_section is null or p.category = p_section)
    and (p_varieties is null or array_length(p_varieties,1) is null
         or (p.data->>'variety') = any(p_varieties))
    and (p_price_min is null or coalesce(p.price, (p.data->>'price')::numeric) >= p_price_min)
    and (p_price_max is null or coalesce(p.price, (p.data->>'price')::numeric) <= p_price_max)
    and (not p_shahti_only or p.shahti_status = 'approved')
    and (not p_free_delivery_only
         or coalesce(s.free_delivery,false)
         or coalesce((s.offers->>'freeDelivery')::boolean,false))
    and (not p_bundle_only
         or (s.offers ? 'bundle'
             and coalesce((s.offers->'bundle'->>'active')::boolean, true)))
    and (not p_discount_only
         or coalesce((s.offers->'discount'->>'percent')::numeric,0) > 0)
  order by
    -- out-of-stock always sinks to the bottom, for every sort
    (p.stock is null or p.stock > 0) desc,
    -- the composite "الأنسب" keys (only when sort = best)
    case when p_sort='best' then (coalesce(s.trusted_badge,false) or p.vendor_role='farmer') end desc nulls last,
    case when p_sort='best' then (p.shahti_status='approved') end desc nulls last,
    case when p_sort='best' then s.average_rating end desc nulls last,
    -- explicit sorts
    case when p_sort='price_asc'  then coalesce(p.price,(p.data->>'price')::numeric) end asc  nulls last,
    case when p_sort='price_desc' then coalesce(p.price,(p.data->>'price')::numeric) end desc nulls last,
    case when p_sort='rating'     then s.average_rating end desc nulls last,
    -- newest first is the universal final tiebreaker
    p.created_at desc
  limit greatest(coalesce(p_limit,60),0)
  offset greatest(coalesce(p_offset,0),0);
$$;
grant execute on function public.browse_products(text,text,text[],numeric,numeric,boolean,boolean,boolean,boolean,int,int)
  to anon, authenticated;

-- ── 4. STORE browse: composite "best" + rating/newest/price + filters ───────
-- Aggregates each store's visible products to expose product_count and the
-- "يبدأ من" starting price, plus the trust/rating fields used by the cards.
-- p_section / p_varieties scope the aggregate so the section screen can list
-- only stores that actually carry matching products.
create or replace function public.browse_stores(
  p_section            text    default null,
  p_sort               text    default 'best',   -- best|rating|newest|price_asc|price_desc
  p_varieties          text[]  default null,
  p_shahti_only        boolean default false,
  p_free_delivery_only boolean default false,
  p_limit              int     default 60,
  p_offset             int     default 0
) returns table(
  vendor_id uuid, name text, image_path text, description text,
  shahti_free boolean, free_delivery boolean, offers jsonb,
  trusted_badge boolean, badge_source text, ratings_count int, average_rating numeric,
  product_count int, in_stock_count int, min_price numeric, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with agg as (
    select p.vendor_id,
           count(*) as product_count,
           count(*) filter (where p.stock is null or p.stock > 0) as in_stock_count,
           min(coalesce(p.price,(p.data->>'price')::numeric)) as min_price
    from public.products p
    where p.status = 'available'
      and coalesce(p.category,'') <> 'savings'
      and (p_section is null or p.category = p_section)
      and (p_varieties is null or array_length(p_varieties,1) is null
           or (p.data->>'variety') = any(p_varieties))
    group by p.vendor_id
  )
  select s.vendor_id, s.name, s.image_path, s.description,
         s.shahti_free, s.free_delivery, s.offers,
         s.trusted_badge, s.badge_source, s.ratings_count, s.average_rating,
         a.product_count::int, a.in_stock_count::int, a.min_price, s.updated_at
  from public.stores s
  join agg a on a.vendor_id = s.vendor_id
  where coalesce(s.enabled, true)
    and (not p_shahti_only or coalesce(s.shahti_free,false))
    and (not p_free_delivery_only
         or coalesce(s.free_delivery,false)
         or coalesce((s.offers->>'freeDelivery')::boolean,false))
  order by
    (a.in_stock_count > 0) desc,
    case when p_sort='best' then s.trusted_badge end desc nulls last,
    case when p_sort='best' then s.shahti_free end desc nulls last,
    case when p_sort in ('best','rating') then s.average_rating end desc nulls last,
    case when p_sort='price_asc'  then a.min_price end asc  nulls last,
    case when p_sort='price_desc' then a.min_price end desc nulls last,
    s.updated_at desc nulls last
  limit greatest(coalesce(p_limit,60),0)
  offset greatest(coalesce(p_offset,0),0);
$$;
grant execute on function public.browse_stores(text,text,text[],boolean,boolean,int,int)
  to anon, authenticated;
