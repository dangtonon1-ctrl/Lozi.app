-- FIX 2: SECURITY DEFINER catalog RPCs bypass RLS, so the wholesale visibility
-- gate must be enforced inside each one. Predicate mirrors the read_products
-- RLS policy exactly: wholesale rows are visible only to can_see_wholesale().
--
-- Applied to live project niloddwnllhsvrmuxfxw on 2026-07-18 (see DEPLOYMENT_LOG.md).

-- 1) browse_products — the live leak (returned wholesale rows/prices to anon).
create or replace function public.browse_products(
  p_section text default null, p_sort text default 'best', p_varieties text[] default null,
  p_price_min numeric default null, p_price_max numeric default null,
  p_shahti_only boolean default false, p_free_delivery_only boolean default false,
  p_bundle_only boolean default false, p_discount_only boolean default false,
  p_limit integer default 60, p_offset integer default 0)
returns setof products
language sql stable security definer
set search_path to 'public'
as $function$
  select p.*
  from public.products p
  left join public.stores s on s.vendor_id = p.vendor_id
  where p.status = 'available'
    and coalesce(p.category,'') not in ('savings','vip')
    and (coalesce(p.market_segment,'retail') <> 'wholesale' or public.can_see_wholesale())  -- SECURITY: wholesale gate
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
    p.created_at desc
  limit greatest(coalesce(p_limit,60),0)
  offset greatest(coalesce(p_offset,0),0);
$function$;

-- 2) browse_stores — gate inside the aggregate so wholesale products never
--    contribute to product_count / in_stock_count / min_price for non-wholesale viewers.
create or replace function public.browse_stores(
  p_section text default null, p_sort text default 'best', p_varieties text[] default null,
  p_shahti_only boolean default false, p_free_delivery_only boolean default false,
  p_limit integer default 60, p_offset integer default 0)
returns table(vendor_id uuid, name text, image_path text, description text, shahti_free boolean,
  free_delivery boolean, offers jsonb, trusted_badge boolean, badge_source text,
  ratings_count integer, average_rating numeric, product_count integer, in_stock_count integer,
  min_price numeric, updated_at timestamp with time zone)
language sql stable security definer
set search_path to 'public'
as $function$
  with agg as (
    select p.vendor_id,
           count(*) as product_count,
           count(*) filter (where p.stock is null or p.stock > 0) as in_stock_count,
           min(coalesce(p.price,(p.data->>'price')::numeric)) as min_price
    from public.products p
    where p.status = 'available'
      and coalesce(p.category,'') not in ('savings','vip')
      and (coalesce(p.market_segment,'retail') <> 'wholesale' or public.can_see_wholesale())  -- SECURITY: wholesale gate
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
$function$;

-- 3) get_store_public_stats — gate the per-vendor product_count too; a count that
--    includes hidden wholesale rows is itself an information leak.
create or replace function public.get_store_public_stats(p_vendor_id uuid)
returns table(member_since timestamp with time zone, product_count integer,
  delivered_count integer, average_rating numeric, ratings_count integer)
language sql stable security definer
set search_path to 'public'
as $function$
  select
    (select pr.created_at from profiles pr where pr.user_id = p_vendor_id),
    (select count(*)::int from products p
       where p.vendor_id = p_vendor_id and p.status = 'available'
         and (coalesce(p.market_segment,'retail') <> 'wholesale' or public.can_see_wholesale())),  -- SECURITY: wholesale gate
    (select count(*)::int from order_seller_groups g
       where g.seller_id = p_vendor_id and g.fulfillment_status = 'delivered_to_customer'),
    (select s.average_rating from stores s where s.vendor_id = p_vendor_id),
    (select s.ratings_count  from stores s where s.vendor_id = p_vendor_id);
$function$;
