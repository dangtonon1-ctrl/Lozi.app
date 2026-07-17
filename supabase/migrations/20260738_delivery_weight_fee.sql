-- ============================================================================
-- M3 -- Delivery weight-fee layer  (retail-by-kg fee overhaul, step 3 of 4)
--       project niloddwnllhsvrmuxfxw
--
-- Extends the authoritative orders trigger lozi_orders_enforce_delivery_fee()
-- (last defined in 20260735) to charge a per-kilogram weight fee ON TOP of the
-- M1 store fee, reading grams numerically from products.weight_grams (M2) -- no
-- more text parsing. Also records a display-only vehicle_type on the order.
--
-- LOCKED MODEL (retail path only):
--   store_fee    = lozi_delivery_fee(distinct_sellers)          -- M1: min(1000+300*(n-1),2500)
--   free_kg      = 20 + 10*(distinct_sellers - 1)
--   billable_kg  = floor( sum(grams per line) / 1000 )          -- fractional kg dropped
--   weight_fee   = max(0, billable_kg - free_kg) * 30           -- UNCAPPED
--   delivery_fee = store_fee + weight_fee
--   vehicle_type = 'motorcycle' if raw_kg <= 50 else 'truck'    -- raw (un-floored) grams/1000
--
-- Per-line grams (summed in the existing items CTE):
--   * catalog (uuid) line -> q * coalesce(products.weight_grams, 1000)
--       - a byAmount line is a uuid line with weight_grams = 1000 and q already
--         = floor(amount/price*1000)/1000, so q*1000 == the floor-derived grams.
--       - NULL weight_grams (a retail product created by the pre-RN-Phase-2 seller
--         form) falls back to 1000 (1 kg) -- the sold-by-kg default. DECISION.
--   * RFQ / any non-uuid line -> 0 grams (keeps RFQ's current store-fee-only
--     treatment; RFQ weight is not in products). DECISION.
--
-- DECISIONS baked in (veto at review if wrong):
--   D-promo   : the single-seller free-delivery promotion waives the STORE FEE
--               ONLY; weight_fee is still charged (protects against an uncapped
--               "free" weight charge; free_kg=20 means most orders pay 0 weight).
--   D-nullwg  : NULL weight_grams -> 1000 g fallback (above).
--   D-vehicle : vehicle_type stored in a new orders.vehicle_type column, set
--               authoritatively here, pinned to OLD on non-admin UPDATE, NULL on
--               the wholesale branch. CHECK in ('motorcycle','truck').
--   D-rfq     : RFQ/non-uuid lines contribute 0 grams (above).
--
-- CLIENT SYNC: intentionally NONE. The web client feeFor() shows the store fee
-- only; the weight_fee is a known, Qaari-accepted display gap for the reference
-- period, closed by the RN Phase 2 client. Server stays authoritative.
--
-- Everything else preserved verbatim from 20260735: admin bypass, non-admin
-- UPDATE pin, the missing/hidden/priceless reject, byAmount D1/D2, the RFQ
-- cross-check, the price/rfq normalization, wholesale early-return (fee NULL),
-- and the free-delivery promo. Only the grams sum, the weight-fee tail and
-- vehicle_type are added.
--
-- Reversible: pre-image at supabase/rollback/20260738_delivery_weight_fee_preimage.sql
-- restores the 20260735 function verbatim and drops orders.vehicle_type. No data
-- touched (INSERT-time logic only; settled orders frozen by the UPDATE pin).
-- ============================================================================

-- 1) Display-only vehicle_type column on orders -------------------------------
alter table public.orders
  add column if not exists vehicle_type text;

alter table public.orders
  drop constraint if exists orders_vehicle_type_valid;
alter table public.orders
  add constraint orders_vehicle_type_valid
  check (vehicle_type is null or vehicle_type in ('motorcycle', 'truck'));

comment on column public.orders.vehicle_type is
  'Display-only delivery vehicle derived from the order raw weight: motorcycle when total grams <= 50000 (50 kg), else truck. Set authoritatively by lozi_orders_enforce_delivery_fee() on the retail path; NULL for wholesale (admin-quoted). Not trusted from the client.';

-- 2) Trigger function: add the weight layer -----------------------------------
create or replace function public.lozi_orders_enforce_delivery_fee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count       int;
  v_subtotal    numeric;
  v_grams       numeric;       -- M3: total order weight in grams
  v_wholesale   boolean;
  v_only_seller uuid;
  v_free_min    numeric;
  v_fee         int;
  v_free_kg     int;           -- M3
  v_billable_kg int;           -- M3
  v_weight_fee  int;           -- M3
begin
  -- Admins are trusted (wholesale quotes, corrections via the admin panel).
  if public.is_admin() then
    return NEW;
  end if;

  -- Non-admin UPDATE: pin fee, line items, total AND vehicle_type to stored values.
  if TG_OP = 'UPDATE' then
    NEW.delivery_fee := OLD.delivery_fee;
    NEW.items        := OLD.items;
    NEW.total        := OLD.total;
    NEW.vehicle_type := OLD.vehicle_type;   -- M3
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
  -- M3: also sum per-line grams (catalog line = q * coalesce(weight_grams,1000);
  -- RFQ/non-uuid line = 0) into v_grams for the weight fee.
  with items as (
    select
      coalesce(
        case when (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
             then (select p.vendor_id from public.products p where p.id = (it->>'p')::uuid) end,
        NEW.seller_vendor_id
      ) as sid,
      coalesce((it->>'price')::numeric, 0) * coalesce((it->>'q')::numeric, 0) as line,
      case when (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
           then coalesce((it->>'q')::numeric, 0)
                * coalesce((select p.weight_grams from public.products p where p.id = (it->>'p')::uuid), 1000)
           else 0 end as grams,
      (it->>'p') as pid
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
  )
  select
    count(distinct sid) filter (where sid is not null),
    coalesce(sum(line), 0),
    coalesce(sum(grams), 0),
    coalesce(bool_or(
      pid ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1 from public.products p
        where p.id = pid::uuid and lower(coalesce(p.category, '')) = 'wholesale'
      )
    ), false),
    (array_agg(distinct sid) filter (where sid is not null))[1]
  into v_count, v_subtotal, v_grams, v_wholesale, v_only_seller
  from items;

  v_count := coalesce(v_count, 0);
  v_grams := coalesce(v_grams, 0);

  -- Wholesale: delivery is quoted by an admin later, never by the formula or client.
  if coalesce(v_wholesale, false) then
    NEW.delivery_fee := null;
    NEW.vehicle_type := null;               -- M3: admin quotes bulk delivery separately
    NEW.total := round(v_subtotal)::int;
    return NEW;
  end if;

  -- Retail: authoritative store fee from the real distinct-seller count (M1 formula).
  v_fee := public.lozi_delivery_fee(v_count);

  -- Seller free-delivery promotion (single-seller orders only). D-promo: waives the
  -- STORE FEE ONLY; the weight fee below is still charged.
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

  -- Weight fee (M3). v_grams already summed above (RFQ lines = 0; NULL weight_grams
  -- fell back to 1000). billable_kg drops the fractional kilo; weight_fee is uncapped.
  v_free_kg     := 20 + 10 * (greatest(v_count, 1) - 1);
  v_billable_kg := floor(v_grams / 1000.0)::int;
  v_weight_fee  := greatest(0, v_billable_kg - v_free_kg) * 30;

  NEW.delivery_fee := v_fee + v_weight_fee;
  NEW.vehicle_type := case when v_grams <= 50000 then 'motorcycle' else 'truck' end;
  NEW.total := round(v_subtotal)::int + NEW.delivery_fee;

  return NEW;
end;
$function$;

comment on function public.lozi_orders_enforce_delivery_fee() is
  'BEFORE INSERT/UPDATE on orders. Non-admin INSERT: rejects missing/hidden/priceless catalog items; byAmount D1/D2; RFQ cross-check; rewrites catalog/rfq prices; then delivery_fee = store_fee (lozi_delivery_fee) + weight_fee (max(0, floor(sum grams/1000) - (20+10*(n-1)))*30, grams = q*coalesce(products.weight_grams,1000) for catalog lines, 0 for rfq), and sets vehicle_type (motorcycle<=50kg else truck). Free-delivery promo waives store fee only. Non-admin UPDATE pins items/total/fee/vehicle_type to OLD. Admins bypass. Wholesale: fee/vehicle NULL (admin-quoted). Keep byAmount grams (floor(amount/price*1000)) in sync with the client; weight_fee is server-only (RN Phase 2 client gap).';
