-- Server-side authority for order delivery fees.
--
-- The client (checkout) shows a delivery fee for display only; the value it POSTs
-- must never be trusted. A malicious customer could insert an order with a fake low
-- `delivery_fee`. This migration makes the database the source of truth: it recomputes
-- the fee from the order's real distinct sellers and overwrites whatever the client
-- sent, so tampering silently self-heals.
--
-- Live data model (see 20260709_hub_spoke_fulfillment):
--   * public.orders            -- one row per order; delivery_fee int lives here.
--   * public.orders.items      -- jsonb array of line items [{p:<product_id>, q, price, ...}],
--                                 written inline in the SAME insert as the order row.
--   * a line item's seller is products.vendor_id (looked up from items[].p), falling
--     back to orders.seller_vendor_id -- identical to sync_order_seller_groups().
--
-- Because the line items are a jsonb column populated atomically with the order row
-- (not inserted afterwards into a child table), a BEFORE INSERT/UPDATE trigger on
-- `orders` can read NEW.items directly. No order-items trigger or finalize-RPC is
-- needed. Commission logic is untouched: goods_subtotal = total - delivery_fee stays
-- the goods value, so delivery_fee remains excluded from the commission base.

-- ---------------------------------------------------------------------------
-- 1) Pure formula helper (IMMUTABLE). Kept in sync with the client (app.shop.js:
--    FEE = 1000, +250 per extra distinct store, capped at 2000).
-- ---------------------------------------------------------------------------
create or replace function public.lozi_delivery_fee(store_count int)
returns int
language sql
immutable
set search_path = ''            -- pure arithmetic; no schema resolution needed
as $$
  -- Tunable constants -- keep in sync with the client formula:
  --   base fee per order .......... 1000
  --   surcharge per extra store ...  250
  --   hard cap .................... 2000
  select case
    when store_count < 1 then 0          -- no sellers -> nothing to deliver
    else least(
      1000 + 250 * (greatest(store_count, 1) - 1),
      2000
    )
  end;
$$;

comment on function public.lozi_delivery_fee(int) is
  'Authoritative delivery-fee formula: least(1000 + 250*(max(store_count,1)-1), 2000); 0 when store_count < 1. Keep constants in sync with the client (app.shop.js).';

-- ---------------------------------------------------------------------------
-- 2) BEFORE INSERT/UPDATE trigger on orders: recompute the fee from the real
--    distinct sellers of the order's line items and overwrite NEW.delivery_fee.
--
--    Enforcement scope (smart enforcement):
--      * Admin writes are trusted -- this is the intended manual-override / wholesale
--        quoting path (admin panel), so the row is left exactly as the admin set it.
--      * On UPDATE by a non-admin (e.g. a seller advancing status) the stored fee is
--        pinned to its existing value -- sellers can never move it, and any earlier
--        admin override survives.
--      * On INSERT by a non-admin (the customer checkout, the only client tamper
--        vector) the fee is recomputed authoritatively:
--          - wholesale order  -> NULL (delivery is quoted later by an admin),
--          - free-delivery promo met (single seller) -> 0,
--          - otherwise        -> lozi_delivery_fee(distinct_seller_count).
--        `total` is rebuilt from the line items + the authoritative fee so a
--        tampered-low fee cannot ride through inside `total`.
-- ---------------------------------------------------------------------------
create or replace function public.lozi_orders_enforce_delivery_fee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count       int;
  v_subtotal    numeric;
  v_wholesale   boolean;
  v_only_seller uuid;
  v_free_min    numeric;
  v_fee         int;
begin
  -- Admins are trusted: leave their value untouched (wholesale quotes, corrections).
  if public.is_admin() then
    return NEW;
  end if;

  -- Non-admin UPDATE: pin the delivery fee to whatever is already stored. Sellers may
  -- change status etc., but never the fee (and any prior admin override is preserved).
  if TG_OP = 'UPDATE' then
    NEW.delivery_fee := OLD.delivery_fee;
    return NEW;
  end if;

  -- Non-admin INSERT (customer checkout): recompute from the real line items.
  -- Seller resolution mirrors sync_order_seller_groups() so the distinct count matches
  -- what materialises into order_seller_groups.
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
    NEW.total := round(v_subtotal)::int;   -- fee added when the admin quotes it
    return NEW;
  end if;

  -- Retail: authoritative fee from the real distinct-seller count.
  v_fee := public.lozi_delivery_fee(v_count);

  -- Seller free-delivery promotion (single-seller orders only): if that seller
  -- advertises a free-delivery threshold and the goods subtotal meets it, it's free.
  -- Shape mirrors the client: stores.offers -> freeDelivery -> min.
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
  -- Keep total consistent with the authoritative fee. Goods subtotal is taken from the
  -- same line items; validating individual product prices is a separate concern.
  NEW.total := round(v_subtotal)::int + v_fee;

  return NEW;
end;
$$;

comment on function public.lozi_orders_enforce_delivery_fee() is
  'BEFORE INSERT/UPDATE on orders: recompute delivery_fee from the order''s real distinct sellers and overwrite client input. Admins trusted; sellers cannot change the fee; wholesale stays NULL for admin quoting.';

drop trigger if exists trg_orders_enforce_delivery_fee on public.orders;
create trigger trg_orders_enforce_delivery_fee
  before insert or update on public.orders
  for each row
  execute function public.lozi_orders_enforce_delivery_fee();

-- This is a trigger-only function; it must never be callable as a PostgREST RPC.
-- (Triggers still fire regardless of EXECUTE grants.)
revoke execute on function public.lozi_orders_enforce_delivery_fee() from public;
revoke execute on function public.lozi_orders_enforce_delivery_fee() from anon;
revoke execute on function public.lozi_orders_enforce_delivery_fee() from authenticated;
