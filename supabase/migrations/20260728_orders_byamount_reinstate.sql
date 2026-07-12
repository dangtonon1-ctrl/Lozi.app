-- ============================================================================
-- Re-enable the byAmount purchase path under server-side price integrity
-- (project niloddwnllhsvrmuxfxw). Follow-up to 20260727_orders_price_integrity,
-- which disabled byAmount because its old flattened shape {q:1, price:round(amount)}
-- was indistinguishable from a normal unit-priced item: the trigger rewrote
-- price := products.price while q stayed 1, charging a full kilo instead of the
-- intended amount. (Demonstrated on the replica: intended 18,500 -> total 38,000.)
--
-- New contract. A byAmount line carries INTENT only:
--     { p: <uuid>, mode: 'amount', amount: <riyals> }
-- The client sends NO price, q or weight for it. This trigger derives them
-- authoritatively from products.price (the per-kilogram price for the quarter
-- categories), rounding grams DOWN so the customer is never over-charged:
--     price := products.price
--     grams := floor(amount / price * 1000)      -- always round DOWN
--     q     := grams / 1000.0
--     line  := price * q                         -- <= amount, never above
--     weight:= '≈ <grams> جم'                    -- authoritative display
-- Tampering is pointless: a forged amount just means the customer pays that
-- amount; a forged price/q is ignored (re-derived here).
--
-- Scope (decision D1 - quarter categories only): byAmount is honored ONLY for
-- almond/raisin/savings, whose seller form guarantees a 1 kg / per-kilo weight
-- basis, so the client's grams preview == this server's grams. mode='amount' on
-- any other category (retail/vip/wholesale) or a non-uuid (RFQ) id is REJECTED --
-- this also excludes wholesale/RFQ (defense-in-depth; the client never offers it).
--
-- Reject (decision D2): mode='amount' with a non-positive amount, a non-positive
-- product price, or an amount that buys less than one gram (grams < 1) is REJECTED
-- with a clear Arabic error (errcode 23514). The client already blocks below its
-- own minimum; this is the anti-tamper backstop.
--
-- Everything else is preserved verbatim from 20260727: admin bypass, non-admin
-- UPDATE pinning, the missing/hidden/priceless reject, RFQ (non-uuid) exemption,
-- the subtotal/fee/total recompute, and the wholesale delivery branch. Only the
-- non-admin INSERT normalization is extended, in the SAME place (before the
-- subtotal CTE) so the corrected byAmount line flows into v_subtotal, NEW.total,
-- NEW.items and every AFTER trigger (decrement_stock uses the fractional q;
-- sync_order_seller_groups sums the corrected price*q into subtotal_amount).
--
-- Reversible: single CREATE OR REPLACE on one function. Pre-image at
-- supabase/rollback/20260728_orders_byamount_reinstate_preimage.sql. No data touched.
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
  -- missing, hidden, or has no price. Non-uuid items (RFQ 'rfq-...') are exempt.
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

  -- (a)(b) Normalize each catalog item's price from products.price. For byAmount
  -- items (mode='amount') additionally derive grams (round DOWN), q and the display
  -- weight from the authoritative per-kilo price so line = price*q <= amount.
  -- Non-uuid (RFQ) items are left untouched. Order preserved via WITH ORDINALITY.
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
             else elem.it
           end
           order by elem.ord
         )
    into NEW.items
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb))
         with ordinality as elem(it, ord)
    left join public.products pr
      on (elem.it->>'p') ~ '^[0-9a-fA-F-]{36}$' and pr.id = (elem.it->>'p')::uuid;

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
  'BEFORE INSERT/UPDATE on orders. Non-admin INSERT: rejects items whose product is missing/hidden/priceless; honors byAmount intent (mode=''amount'') for quarter categories only, deriving price/grams(floor)/q/weight from products.price (rejects non-positive/sub-gram/non-quarter/non-uuid); overwrites each other catalog item''s price with products.price (RFQ non-uuid items exempt); then recomputes delivery_fee and total. Non-admin UPDATE: pins items/total/fee to OLD. Admins bypass. Keep the fee formula and byAmount grams (floor(amount/price*1000)) in sync with the client (app.shop.js).';
