-- Critical fix: pre-orders (RFQ) silently failed to save.
--
-- When a buyer accepts an RFQ offer, each accepted line is placed in the cart
-- with a synthetic id of the form `rfq-<offer_item_uuid>` (see acceptRfqOffer in
-- src/scripts/app.core.js). At checkout that id is stored verbatim as items[].p
-- inside the order's `items` jsonb column.
--
-- The `decrement_stock` AFTER INSERT trigger on public.orders walked every line
-- and ran `where id = (it->>'p')::uuid`. For a pre-order line the value is
-- `rfq-<uuid>`, which is not valid uuid input, so the cast raised
--   invalid input syntax for type uuid: "rfq-..."
-- That error aborted the whole INSERT, so the order was never saved — while the
-- customer UI still showed a success screen (fixed separately on the client).
--
-- The `rfq-` prefix is deliberately KEPT in the stored order JSON: the admin
-- panel flags pre-orders via items[].p starting with `rfq-`
-- (see src/scripts/admin.js). Pre-order lines are not catalog products, so they
-- have no stock to decrement. The fix therefore hardens the trigger to skip the
-- `rfq-` prefix (and any other non-uuid product reference) BEFORE the ::uuid
-- cast, so a synthetic/malformed id can never again abort an order INSERT, while
-- real catalog products still decrement exactly as before.
--
-- Applied to project niloddwnllhsvrmuxfxw.

create or replace function public.decrement_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare it jsonb; v_pid text;
begin
  if new.items is not null then
    for it in select * from jsonb_array_elements(new.items) loop
      v_pid := it->>'p';
      -- Skip pre-order (RFQ) synthetic ids and any non-uuid product reference so
      -- a bad value can never abort the order INSERT via a failed ::uuid cast.
      continue when v_pid is null;
      continue when v_pid like 'rfq-%';
      continue when v_pid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
      update public.products
        set stock = greatest(0, coalesce(stock,0) - coalesce((it->>'q')::numeric,0))
      where id = v_pid::uuid and stock is not null;
    end loop;
  end if;
  return new;
end $function$;
