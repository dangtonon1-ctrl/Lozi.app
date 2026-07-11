-- ============================================================================
-- Server-side PRICE INTEGRITY for orders (project niloddwnllhsvrmuxfxw).
--
-- Item prices inside orders.items (jsonb) are CLIENT-SUPPLIED. Before this change
-- the database validated only the delivery fee (20260717) and the distinct-seller
-- count; it took items[].price at face value. A malicious customer could POST an
-- order with tampered prices (e.g. a 50,000 product priced at 500). That single
-- lie corrupts, in one INSERT:
--   * the customer charge      -- orders.total = round(sum(price*q)) + fee
--   * the per-seller commission base -- order_seller_groups.subtotal_amount
--     (sync_order_seller_groups sums the SAME price*q), and hence
--   * each seller's commission and their retail/wholesale cumulative counter.
--
-- Fix: fold price normalization into the SAME BEFORE INSERT/UPDATE trigger that
-- already recomputes the fee (lozi_orders_enforce_delivery_fee). Doing it here --
-- at the very top of the non-admin INSERT branch, BEFORE the subtotal is summed --
-- guarantees the corrected prices flow into v_subtotal, NEW.total, the persisted
-- NEW.items, and therefore every AFTER trigger (decrement_stock, make_groups ->
-- sync_order_seller_groups, commission). No new trigger, so no alphabetical
-- firing-order fragility.
--
-- Rules (decisions confirmed for launch):
--   (a) byAmount: catalog items are treated as unit-priced -- EVERY uuid item gets
--       price := products.price and nothing else is recomputed. The dormant
--       byAmount checkout path (which flattens to {q:1, price:amount}) is being
--       disabled client-side in the same change; a coordinated byAmount fix is
--       DEFERRED (see DEPLOYMENT_LOG). This also neutralizes the "≈"-weight trick:
--       there is no per-item opt-out of normalization.
--   (b) price-change race: overwrite silently -- the server price wins; the client
--       cart reconcile already refreshes to live price on load.
--   (c) deleted/missing/hidden product (no row, or status <> 'available', or NULL
--       price): REJECT the whole INSERT with a clear error. The client cart
--       reconcile drops such items, so a well-behaved client never sends them.
--   (d) placement: extend lozi_orders_enforce_delivery_fee (this file).
--   (e) admin: is_admin() keeps its full bypass (wholesale/RFQ quoting, manual
--       corrections). RFQ items (non-uuid p, e.g. 'rfq-...') are skipped -- their
--       price is the accepted-offer price, cross-checked against rfq_offer_items
--       in a later phase (DEFERRED).
--   (f) non-admin UPDATE: pin items AND total (and fee) to their stored OLD values.
--       No legitimate non-admin flow edits line items; a seller advancing status
--       must never move price/total. Closes the seller-UPDATE tamper vector.
--
-- Reversible: single CREATE OR REPLACE on one function. Pre-image captured in
-- supabase/rollback/20260727_orders_price_integrity_preimage.sql. No data touched.
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

  -- Non-admin UPDATE: pin fee, line items AND total to the stored values. Sellers
  -- may advance status etc., but can never move the price, the items, or the total
  -- (and any prior admin override survives).
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

  -- (a)(b) Derive prices from the products table: overwrite each catalog item's
  -- price with the authoritative products.price. Non-uuid (RFQ) items untouched.
  -- Order is preserved via WITH ORDINALITY.
  select jsonb_agg(
           case
             when (elem.it->>'p') ~ '^[0-9a-fA-F-]{36}$'
               then jsonb_set(
                      elem.it,
                      '{price}',
                      to_jsonb((select p.price
                                  from public.products p
                                 where p.id = (elem.it->>'p')::uuid))
                    )
             else elem.it
           end
           order by elem.ord
         )
    into NEW.items
    from jsonb_array_elements(coalesce(NEW.items, '[]'::jsonb))
         with ordinality as elem(it, ord);

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

  -- Seller free-delivery promotion (single-seller orders only). Shape mirrors the
  -- client: stores.offers -> freeDelivery -> min.
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
  'BEFORE INSERT/UPDATE on orders. Non-admin INSERT: rejects items whose product is missing/hidden/priceless, overwrites each catalog item''s price with products.price (RFQ non-uuid items exempt), then recomputes delivery_fee and total from the corrected line items. Non-admin UPDATE: pins items/total/fee to OLD. Admins bypass. Keep the fee formula in sync with the client (app.shop.js).';
