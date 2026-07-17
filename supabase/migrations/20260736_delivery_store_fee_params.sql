-- ============================================================================
-- M1 -- Delivery store-fee parameters: surcharge 250 -> 300, cap 2000 -> 2500.
--
-- Adjusts ONLY the two tunable constants of the authoritative store-fee helper
-- public.lozi_delivery_fee(int) (first defined in 20260717_delivery_fee_server_
-- validation). Structure is unchanged: base 1000, +surcharge per extra distinct
-- seller, hard cap; 0 when store_count < 1.
--
--   before:  least(1000 + 250 * (greatest(store_count, 1) - 1), 2000)
--   after:   least(1000 + 300 * (greatest(store_count, 1) - 1), 2500)
--
-- This helper returns the STORE-FEE component of delivery only. The weight_fee
-- layer (billable_kg over free_kg) is added later in M3, where the orders trigger
-- computes delivery_fee = lozi_delivery_fee(count) + weight_fee. Nothing here
-- reads weight, so M1 is independent and forward-compatible with M2/M3/M4.
--
-- Blast radius: every caller of lozi_delivery_fee() picks up the new constants
-- immediately -- the orders BEFORE INSERT/UPDATE trigger (lozi_orders_enforce_
-- delivery_fee) and the seller-group accept/reject recompute (20260720). No data
-- is modified; existing orders keep their stored delivery_fee (pinned on UPDATE).
--
-- CLIENT SYNC (NOT included here -- backend-only per task scope): the web client
-- duplicates this formula in app.shop.js feeFor(): Math.min(FEE + 250*(n-1), 2000).
-- Left unchanged, a multi-seller (n >= 2) checkout DISPLAYS the old fee while the
-- server CHARGES the new one; single-seller (n = 1) is unaffected (both = 1000).
-- Qaari to decide: bump the client constant in this branch, or defer fee display
-- to RN Phase 2 (server stays authoritative either way).
--
-- Reversible: single CREATE OR REPLACE on one function. Pre-image at
-- supabase/rollback/20260736_delivery_store_fee_params_preimage.sql. No data touched.
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
      1000 + 300 * (greatest(store_count, 1) - 1),
      2500
    )
  end;
$$;

comment on function public.lozi_delivery_fee(int) is
  'Authoritative delivery store-fee component: least(1000 + 300*(max(store_count,1)-1), 2500); 0 when store_count < 1. M3 adds weight_fee on top in the orders trigger. Keep constants in sync with the client (app.shop.js feeFor).';
