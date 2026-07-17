-- ============================================================================
-- ROLLBACK PRE-IMAGE for 20260736_delivery_store_fee_params.sql
--
-- VERBATIM body of public.lozi_delivery_fee(int) as deployed live (project
-- niloddwnllhsvrmuxfxw) immediately BEFORE M1 -- i.e. the 20260717_delivery_fee_
-- server_validation version (surcharge 250, cap 2000), confirmed via
-- pg_get_functiondef at prep time. Re-running this file restores the exact prior
-- fee behavior for every caller (orders trigger + seller-group recompute).
--
-- If the client feeFor() constant in app.shop.js was bumped to 300/2500 in
-- lockstep with M1, roll that client change back together with this file.
--
-- To roll back: run this file. Single CREATE OR REPLACE on one function; the
-- trigger bindings are unchanged. No data modified.
-- ============================================================================

create or replace function public.lozi_delivery_fee(store_count int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when store_count < 1 then 0
    else least(
      1000 + 250 * (greatest(store_count, 1) - 1),
      2000
    )
  end;
$$;

comment on function public.lozi_delivery_fee(int) is
  'Authoritative delivery-fee formula: least(1000 + 250*(max(store_count,1)-1), 2000); 0 when store_count < 1. Keep constants in sync with the client (app.shop.js).';
