-- ============================================================================
-- RFQ PRICE INTEGRITY -- cross-check order lines against accepted rfq_offer_items
-- (project niloddwnllhsvrmuxfxw). Follow-up to 20260727_orders_price_integrity,
-- closing the "RFQ price cross-check" item DEFERRED there.
--
-- THE HOLE. The price-integrity shield (20260727 / 20260728) validates and
-- rewrites only CATALOG (uuid) line items -- every rule is gated on
-- (p ~ '^[0-9a-fA-F-]{36}$'). RFQ lines carry a NON-uuid id, 'rfq-<offer_item_id>'
-- (client: app.main.js acceptRfqOffer -> addToCart({id:"rfq-"+it.offer_item_id,
-- price:oi.price ...}) -> normal checkout INSERT), so they SKIP the missing-product
-- reject AND the price overwrite. Their price and quantity are then taken at FACE
-- VALUE and flow straight into orders.total, order_seller_groups.subtotal_amount,
-- the per-seller commission base, and the seller's cumulative-sales counter.
--
-- Because "RFQ" is nothing but the item SHAPE (a non-uuid p), ANY authenticated
-- customer can forge a normal checkout INSERT with items:[{p:"rfq-<anything>",
-- q:<any>, price:<any>}] and ride the exemption -- the same tamper the catalog
-- shield blocks, through the one door it left open.
--
-- THE FIX (this migration, non-admin INSERT branch only):
--   (1) STRUCTURAL REJECT. Every non-catalog line MUST be a valid, buyer-accepted
--       RFQ line: p matches 'rfq-<uuid>'; the rfq_offer_items row exists; its
--       rfq_offers row is status='accepted'; that offer's request buyer_id equals
--       THIS order's customer_id; that offer's seller_id equals THIS order's
--       seller_vendor_id; and the line quantity is positive and does not exceed the
--       offered available_quantity. Anything else -- a bogus/foreign/unaccepted
--       offer id, a wrong buyer or seller, an over-quantity, OR any other non-uuid
--       p at all (residual bypass) -- is REJECTED (errcode 23514), mirroring the
--       catalog missing-product reject.
--   (2) PRICE REWRITE. Each rfq line's price is overwritten authoritatively from
--       rfq_offer_items.price inside the SAME jsonb_agg normalization that rewrites
--       catalog prices from products.price -- "server price wins, silently"
--       (20260727 rule (b)). A no-op for an honest order (the client already sends
--       the offer price); a tampered price is corrected. The subsequent
--       subtotal/fee/total recompute is UNCHANGED and now runs on corrected inputs.
--
-- SCOPE / preserved verbatim from 20260728: admin (is_admin()) bypass -- admins
-- may still create/correct RFQ or wholesale orders with custom prices; non-admin
-- UPDATE pinning; the catalog missing/hidden/priceless reject; the byAmount D1/D2
-- rules and derivation; the wholesale delivery branch; the retail fee formula and
-- free-delivery promotion. RFQ orders keep their present retail-fee treatment
-- (rfq lines resolve to seller_vendor_id and v_wholesale stays false) -- unchanged
-- here by design; only price/quantity integrity is added.
--
-- Note (single-vendor RFQ checkout): the client's accept flow routes each accepted
-- offer to a per-vendor checkout, so an RFQ order's seller_vendor_id is always the
-- offer's seller (the 3 live RFQ orders confirm single-seller). The seller_id ==
-- seller_vendor_id guard therefore never false-rejects a real order; a hypothetical
-- unified order mixing an rfq line from a non-primary seller would be rejected,
-- which is acceptable (that flow does not exist).
--
-- Data note: all 3 existing live RFQ orders (632952, 758868, 924379) already match
-- their accepted offers exactly (price, qty, buyer, seller) and every live order
-- line is a catalog uuid or a valid rfq-<uuid> -- so this change rejects nothing
-- that exists and needs no backfill.
--
-- Reversible: single CREATE OR REPLACE on one function. Pre-image at
-- supabase/rollback/20260735_orders_rfq_price_crosscheck_preimage.sql
-- (restores md5(pg_get_functiondef(...)) = 64c79140f968d4e4867c267e0d8fd48e).
-- No data touched (INSERT-time logic only; settled orders frozen by the UPDATE pin).
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
    -- Both uuid casts are CASE-guarded: adding the roi join can change this query's
    -- plan, and Postgres may evaluate a join-ON cast before the adjacent regex
    -- filter. The CASE guarantees the cast runs only for a matching id, so an rfq
    -- line can never raise a raw uuid-cast error in the catalog (pr) join, and a
    -- catalog line never reaches the rfq (roi) cast. Behaviour is identical to the
    -- pre-image for every well-formed line.
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

comment on function public.lozi_orders_enforce_delivery_fee() is
  'BEFORE INSERT/UPDATE on orders. Non-admin INSERT: rejects items whose catalog product is missing/hidden/priceless; honors byAmount intent (mode=''amount'') for quarter categories only, deriving price/grams(floor)/q/weight from products.price; cross-checks every non-catalog line against an ACCEPTED rfq_offer_items row (rfq-<offer_item_id>): rejects bad/unaccepted/foreign-buyer/foreign-seller/over-quantity lines and any other non-uuid p, and rewrites its price from rfq_offer_items.price; overwrites each catalog item''s price with products.price; then recomputes delivery_fee and total. Non-admin UPDATE: pins items/total/fee to OLD. Admins bypass. Keep the fee formula and byAmount grams (floor(amount/price*1000)) in sync with the client (app.shop.js).';
