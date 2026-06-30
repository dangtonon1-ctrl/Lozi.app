-- Lozi — سوق VIP (VIP Market)
-- Premium, fully admin-controlled market stored in the existing `products`
-- table under category = 'vip'. VIP products are bespoke items the ADMIN
-- creates from zero; vendors cannot publish here at all. Orders are managed
-- by the platform directly (no vendor), exactly like قسم التوفير ('savings').
--
-- This migration adds:
--   1. Restrictive RLS so ONLY admins can write (insert/update/delete) any
--      product row whose category is 'vip'. SELECT stays open so the
--      customer-facing VIP page can read active VIP products.
--   2. Exclusion of 'vip' from the public browse_products / browse_stores
--      RPCs, so VIP products never leak into the normal green marketplace
--      (mirrors how 'savings' is already excluded).

-- ── 1. VIP write access = admin only (enforced in the database) ─────────────
-- Restrictive policies are AND-combined with the permissive ones, so these
-- gate every write path (own_products, products_insert_own, …) without
-- touching non-VIP products or any SELECT.

drop policy if exists products_vip_insert_admin on public.products;
create policy products_vip_insert_admin on public.products
  as restrictive for insert to authenticated
  with check (coalesce(category,'') <> 'vip' or public.is_admin());

drop policy if exists products_vip_update_admin on public.products;
create policy products_vip_update_admin on public.products
  as restrictive for update to authenticated
  using (coalesce(category,'') <> 'vip' or public.is_admin())
  with check (coalesce(category,'') <> 'vip' or public.is_admin());

drop policy if exists products_vip_delete_admin on public.products;
create policy products_vip_delete_admin on public.products
  as restrictive for delete to authenticated
  using (coalesce(category,'') <> 'vip' or public.is_admin());

-- ── 2. Keep VIP out of the normal marketplace browse ────────────────────────
-- Same shape as before; only the category filter changes
-- ('savings' -> not in ('savings','vip')).
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
    and coalesce(p.category,'') not in ('savings','vip')
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
    (p.stock is null or p.stock > 0) desc,
    case when p_sort='best' then (coalesce(s.trusted_badge,false) or p.vendor_role='farmer') end desc nulls last,
    case when p_sort='best' then (p.shahti_status='approved') end desc nulls last,
    case when p_sort='best' then s.average_rating end desc nulls last,
    case when p_sort='price_asc'  then coalesce(p.price,(p.data->>'price')::numeric) end asc  nulls last,
    case when p_sort='price_desc' then coalesce(p.price,(p.data->>'price')::numeric) end desc nulls last,
    case when p_sort='rating'     then s.average_rating end desc nulls last,
    p.created_at desc
  limit greatest(coalesce(p_limit,60),0)
  offset greatest(coalesce(p_offset,0),0);
$$;
grant execute on function public.browse_products(text,text,text[],numeric,numeric,boolean,boolean,boolean,boolean,int,int)
  to anon, authenticated;

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
      and coalesce(p.category,'') not in ('savings','vip')
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
