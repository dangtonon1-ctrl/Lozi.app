-- ============================================================================
-- M4 -- byAmount retail expansion + per-product toggle  (step 4 of 4)
--       project niloddwnllhsvrmuxfxw
--
-- Expands the byAmount (buy-by-money-amount) scope from the old quarter
-- categories (almond/raisin/savings) to ALL consumer sold-by-kg products, and
-- adds a per-product opt-out. Server D1 gate is now:
--     is_consumer (category <> 'wholesale')
--       AND weight_grams = 1000          -- sold-by-kg 1 kg basis (M2); excludes
--                                            fixed packs (<>1000) and NULL/unknown
--       AND NOT (data->>'bundle')        -- excludes fixed assorted bundles
--       AND allow_byamount               -- new per-product column, DEFAULT true
-- Wholesale is hard-rejected structurally (category='wholesale'); RFQ (non-uuid)
-- can never byAmount. D2 (amount>0, price>0, buys >= 1 gram) is unchanged.
--
-- Continuous-weight vs fixed-pack (confirmed pre-M4): the only non-continuous
-- marker today is data.bundle=true (assorted offer, "contents & weights can't be
-- changed"); data.unit is unused. weight_grams=1000 (M2) is the numeric sold-by-kg
-- signal, so the gate excludes bundles AND any weight_grams<>1000 fixed pack.
--
-- byAmount derivation is UNCHANGED and stays in lockstep with the client: a
-- byAmount line still normalizes to grams = floor(amount/price*1000), q = grams/1000
-- (valid because the gate requires weight_grams=1000, i.e. price is per-kg). The
-- M3 weight-fee sum q*coalesce(weight_grams,1000) is likewise unaffected.
--
-- Store-level "apply to all retail" is a UI bulk-write (RN Phase 2); the per-product
-- products.allow_byamount column is the ONLY source of truth. Seller-form toggle +
-- kg-enforcement UI stay deferred to RN Phase 2.
--
-- CLIENT (shipped in lockstep, same branch): rowToProduct exposes weight_grams &
-- allow_byamount; the Product page reads p.weight_grams instead of weightKg(); and
-- the customer byAmount gate mirrors this predicate. The weight-fee DISPLAY stays
-- store-fee-only (accepted RN Phase 2 gap).
--
-- Everything else in the function is preserved verbatim from 20260738 (M3): admin
-- bypass, UPDATE pin, missing/hidden/priceless reject, RFQ cross-check, price/rfq
-- normalization, byAmount grams derivation, wholesale early-return, weight fee and
-- vehicle_type. Only the byAmount D1 gate changes.
--
-- Reversible: pre-image at supabase/rollback/20260739_byamount_retail_expansion_preimage.sql
-- restores the 20260738 function (old almond/raisin/savings gate) and drops
-- products.allow_byamount. No order data touched (INSERT-time logic only).
-- ============================================================================

-- 1) Per-product byAmount opt-out (default true) ------------------------------
alter table public.products
  add column if not exists allow_byamount boolean not null default true;

comment on column public.products.allow_byamount is
  'Per-product byAmount (buy-by-amount) opt-out. DEFAULT true. The byAmount gate is is_consumer AND weight_grams=1000 AND NOT data.bundle AND allow_byamount. Store-level "apply to all retail" is an RN Phase 2 UI bulk-write over this column; this column is the only source of truth.';

-- 2) Trigger function: widen the byAmount D1 gate -----------------------------
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

  -- byAmount gate (M4 -- D1 scope + D2 reject). A byAmount line carries mode='amount'.
  -- Allow ONLY a consumer (non-wholesale), sold-by-kg (weight_grams = 1000), non-bundle
  -- product with allow_byamount; reject otherwise, plus reject when the amount is
  -- non-positive / the price is non-positive / it buys less than one gram. Wholesale is
  -- hard-rejected structurally; RFQ (non-uuid) can never byAmount.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb)) it
    left join public.products p
      on (it->>'p') ~ '^[0-9a-fA-F-]{36}$' and p.id = (it->>'p')::uuid
    where (it->>'mode') = 'amount'
      and (
            (it->>'p') !~ '^[0-9a-fA-F-]{36}$'
         or p.category is null or p.category = 'wholesale'             -- consumer only; wholesale hard-reject
         or coalesce(p.weight_grams, 0) <> 1000                        -- sold-by-kg 1 kg basis (excludes fixed packs + NULL)
         or coalesce((p.data->>'bundle')::boolean, false)              -- exclude fixed bundles
         or coalesce(p.allow_byamount, true) = false                   -- seller opt-out
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
  'BEFORE INSERT/UPDATE on orders. Non-admin INSERT: rejects missing/hidden/priceless catalog items; byAmount gate (mode=''amount'' allowed only for consumer/non-wholesale, weight_grams=1000, non-bundle, allow_byamount products that buy >=1 gram; wholesale & RFQ hard-rejected); RFQ cross-check; rewrites catalog/rfq prices; then delivery_fee = store_fee (lozi_delivery_fee) + weight_fee (max(0, floor(sum grams/1000) - (20+10*(n-1)))*30, grams = q*coalesce(products.weight_grams,1000) for catalog lines, 0 for rfq), and sets vehicle_type (motorcycle<=50kg else truck). Free-delivery promo waives store fee only. Non-admin UPDATE pins items/total/fee/vehicle_type to OLD. Admins bypass. Wholesale: fee/vehicle NULL (admin-quoted). Keep byAmount grams (floor(amount/price*1000)) in sync with the client; weight_fee is server-only (RN Phase 2 client gap).';
