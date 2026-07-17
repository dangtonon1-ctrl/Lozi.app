-- ============================================================================
-- ROLLBACK PRE-IMAGE for 20260738_delivery_weight_fee.sql
--
-- Restores public.lozi_orders_enforce_delivery_fee() to its verbatim pre-M3 body
-- (the 20260735_orders_rfq_price_crosscheck version -- store fee only, no weight
-- layer, no vehicle_type) and drops the orders.vehicle_type column + constraint.
--
-- Re-running this file returns delivery pricing to store-fee-only. data.weight and
-- products.weight_grams are untouched (M2 stays); only M3's function change and the
-- vehicle_type column are reverted. Roll back M4 first if it is applied (M4 builds
-- on this same function).
--
-- Single transaction; trigger binding (trg_orders_enforce_delivery_fee) unchanged;
-- no order data modified.
-- ============================================================================

create or replace function public.lozi_orders_enforce_delivery_fee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count       int;
  v_subtotal    numeric;
  v_wholesale   boolean;
  v_only_seller uuid;
  v_free_min    numeric;
  v_fee         int;
begin
  -- Admins are trusted (wholesale quotes, corrections via the admin panel).
  if public.is_admin() then
    return NEW;
  end if;

  -- Non-admin UPDATE: pin fee, line items AND total to the stored values.
  if TG_OP = 'UPDATE' then
    NEW.delivery_fee := OLD.delivery_fee;
    NEW.items        := OLD.items;
    NEW.total        := OLD.total;
    return NEW;
  end if;

  -- ---- Non-admin INSERT (customer checkout) --------------------------------

  -- (c) Reject if any catalog (uuid) line item references a product that is
  -- missing, hidden, or has no price. Non-uuid items (RFQ 'rfq-...') are exempt
  -- HERE and validated by the RFQ cross-check block that follows.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
    where (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
      and not exists (
        select 1 from public.products p
        where p.id = (it->>'p')::uuid
          and p.status = 'available'
          and p.price is not null
      )
  ) then
    raise exception
      'PRICE_INTEGRITY: order contains an item whose product is missing or unavailable'
      using errcode = '23514';
  end if;

  -- byAmount integrity (D1 scope + D2 reject). A byAmount line carries mode='amount'.
  -- Reject it when it is not a per-kilo quarter product, or the amount is
  -- non-positive / the price is non-positive / the amount buys less than one gram.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
    left join public.products p
      on (it->>'p') ~ '^[0-9a-fA-F-]{36}$' and p.id = (it->>'p')::uuid
    where (it->>'mode') = 'amount'
      and (
            (it->>'p') !~ '^[0-9a-fA-F-]{36}$'
         or coalesce(p.category,'') not in ('almond','raisin','savings')
         or coalesce((it->>'amount')::numeric, 0) <= 0
         or coalesce(p.price, 0) <= 0
         or floor(coalesce((it->>'amount')::numeric, 0) / nullif(p.price, 0) * 1000) < 1
          )
  ) then
    raise exception
      'PRICE_INTEGRITY: المبلغ لا يكفي لشراء غرام واحد من هذا المنتج، أو المنتج غير مؤهل للشراء بالمبلغ'
      using errcode = '23514';
  end if;

  -- RFQ cross-check + residual non-uuid guard. Every NON-catalog line must be a
  -- valid, buyer-accepted RFQ line. Reject the whole INSERT if any non-catalog
  -- line: (i) is not shaped 'rfq-<uuid>'; (ii) has no matching rfq_offer_items row;
  -- (iii) belongs to an offer that is not 'accepted'; (iv) belongs to a request
  -- owned by a different buyer than this order's customer; (v) belongs to an offer
  -- sold by a different seller than this order's seller_vendor_id; or (vi) has a
  -- non-positive quantity or a quantity above the offered available_quantity.
  -- Price is NOT checked here -- it is rewritten authoritatively below.
  --
  -- The offer-item uuid cast is guarded by a CASE keyed on a STRICT uuid regex so a
  -- malformed 'rfq-...' id can never raise a raw uuid-cast error (Postgres may
  -- evaluate a join-ON cast eagerly regardless of an adjacent regex guard); a
  -- non-canonical id simply fails the '~' shape test on line (i) and is rejected.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
    left join public.rfq_offer_items oi
      on oi.id = case
                   when (it->>'p') ~ '^rfq-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                   then substring((it->>'p') from 5)::uuid
                 end
    left join public.rfq_offers   off on off.id = oi.offer_id
    left join public.rfq_requests req on req.id = off.request_id
    where (it->>'p') !~ '^[0-9a-fA-F-]{36}$'          -- non-catalog lines only
      and (
            (it->>'p') !~ '^rfq-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'  -- (i)
         or oi.id is null                                          -- (ii)
         or off.status is distinct from 'accepted'                 -- (iii)
         or req.buyer_id is distinct from NEW.customer_id          -- (iv)
         or off.seller_id is distinct from NEW.seller_vendor_id    -- (v)
         or coalesce((it->>'q')::numeric, 0) <= 0                  -- (vi)
         or coalesce((it->>'q')::numeric, 0) > oi.available_quantity
          )
  ) then
    raise exception
      'PRICE_INTEGRITY: RFQ item does not match an accepted offer (invalid id, not accepted, wrong buyer/seller, or quantity exceeds the offered amount)'
      using errcode = '23514';
  end if;

  -- (a)(b) Normalize each catalog item's price from products.price. For byAmount
  -- items (mode='amount') additionally derive grams (round DOWN), q and the display
  -- weight from the authoritative per-kilo price so line = price*q <= amount. RFQ
  -- lines ('rfq-<uuid>') get their price overwritten from the accepted
  -- rfq_offer_items.price (validated above). Order preserved via WITH ORDINALITY.
  select jsonb_agg(
           case
             when (elem.it->>'p') ~ '^[0-9a-fA-F-]{36}$' and (elem.it->>'mode') = 'amount' then
               jsonb_build_object(
                 'p',      elem.it->>'p',
                 'mode',   'amount',
                 'amount', (elem.it->>'amount')::numeric,
                 'price',  pr.price,
                 'q',      round(floor((elem.it->>'amount')::numeric / pr.price * 1000) / 1000.0, 3),
                 'weight', '≈ ' || floor((elem.it->>'amount')::numeric / pr.price * 1000)::int || ' جم',
                 'name',   coalesce(elem.it->>'name', pr.name)
               )
             when (elem.it->>'p') ~ '^[0-9a-fA-F-]{36}$' then
               jsonb_set(elem.it, '{price}', to_jsonb(pr.price))
             when (elem.it->>'p') ~ '^rfq-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
               jsonb_set(elem.it, '{price}', to_jsonb(roi.price))
             else elem.it
           end
           order by elem.ord
         )
    into NEW.items
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb))
         with ordinality as elem(it, ord)
    left join public.products pr
      on pr.id = case
                   when (elem.it->>'p') ~ '^[0-9a-fA-F-]{36}$'
                   then (elem.it->>'p')::uuid
                 end
    left join public.rfq_offer_items roi
      on roi.id = case
                    when (elem.it->>'p') ~ '^rfq-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    then substring((elem.it->>'p') from 5)::uuid
                  end;

  -- From here on NEW.items carries authoritative prices. Recompute fee/total from
  -- the corrected line items. Seller resolution mirrors sync_order_seller_groups().
  with items as (
    select
      coalesce(
        case when (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
             then (select p.vendor_id from public.products p where p.id = (it->>'p')::uuid) end,
        NEW.seller_vendor_id
      ) as sid,
      coalesce((it->>'price')::numeric, 0) * coalesce((it->>'q')::numeric, 0) as line,
      (it->>'p') as pid
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
  )
  select
    count(distinct sid) filter (where sid is not null),
    coalesce(sum(line), 0),
    coalesce(bool_or(
      pid ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1 from public.products p
        where p.id = pid::uuid and lower(coalesce(p.category, '')) = 'wholesale'
      )
    ), false),
    (array_agg(distinct sid) filter (where sid is not null))[1]
  into v_count, v_subtotal, v_wholesale, v_only_seller
  from items;

  v_count := coalesce(v_count, 0);

  -- Wholesale: delivery is quoted by an admin later, never by the formula or client.
  if coalesce(v_wholesale, false) then
    NEW.delivery_fee := null;
    NEW.total := round(v_subtotal)::int;
    return NEW;
  end if;

  -- Retail: authoritative fee from the real distinct-seller count.
  v_fee := public.lozi_delivery_fee(v_count);

  -- Seller free-delivery promotion (single-seller orders only).
  if v_count = 1 and v_only_seller is not null then
    select nullif(s.offers #>> '{freeDelivery,min}', '')::numeric
      into v_free_min
      from public.stores s
     where s.vendor_id = v_only_seller
     limit 1;
    if v_free_min is not null and v_subtotal >= v_free_min then
      v_fee := 0;
    end if;
  end if;

  NEW.delivery_fee := v_fee;
  NEW.total := round(v_subtotal)::int + v_fee;

  return NEW;
end;
$function$;

-- Drop the M3 display-only column (and its check).
alter table public.orders drop constraint if exists orders_vehicle_type_valid;
alter table public.orders drop column if exists vehicle_type;
