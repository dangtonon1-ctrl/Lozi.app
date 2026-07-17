-- ============================================================================
-- M2 -- products.weight_grams: numeric source of truth for retail weight.
--       (retail-by-kg fee overhaul, step 2 of 4; project niloddwnllhsvrmuxfxw)
--
-- LOCKED MODEL: weight_grams (integer) = net grams of the unit that `price`
-- refers to. Retail is sold in KILOGRAMS as the unit of measure, so `price` is
-- price-per-kg and the sold-by-kg basis is weight_grams = 1000; a fixed pack may
-- carry its literal net grams. This replaces the free-text data.weight parsed by
-- weightKg() (app.shop.js) as the reliable grams source read by the M3 weight-fee
-- layer and the M4 byAmount derivation.
--
-- data.weight is free text; 6 of 25 visible products mis-parse (Step-0 findings).
-- This migration, on Qaari's decisions:
--   1) adds products.weight_grams integer  (nullable; CHECK > 0 when present)
--   2) backfills cleanly-parseable sold-by-kg retail ("1" / "1 كيلو") -> 1000
--   3) sets the two live mis-parses that stay visible -> 1000
--        e9b734f3 "لوززز ذماري" (data.weight "500" => was the 500 kg bug)
--        1594de4a "تجربة تجزئة" (data.weight "عرض مشكّل", bundle)
--   4) hides the four junk test rows (their weight_grams stays NULL)
--        e17b23b7 "و", 378c34e3 "ف", 72fabeb0 "حبة البركة", 72757f62 "غ"
-- Wholesale weight_grams is intentionally left NULL (admin-quoted delivery, no
-- weight_fee; M4 hard-rejects wholesale byAmount -- no consumer in M1..M4).
--
-- price=per-kg invariant: every backfilled row is a 1 kg basis, so the stored
-- `price` already equals price-per-kg -- NO price data is changed here. Enforcing
-- kg at input time is the seller form, DEFERRED to RN Phase 2.
--
-- data.weight is left untouched (kept as the display/audit string). Reversible:
-- supabase/rollback/20260737_products_weight_grams_preimage.sql drops the column
-- and un-hides the four rows (roll back M3/M4 first if they are applied).
-- ============================================================================

-- 1) Column + positivity guard ------------------------------------------------
alter table public.products
  add column if not exists weight_grams integer;

alter table public.products
  drop constraint if exists products_weight_grams_positive;
alter table public.products
  add constraint products_weight_grams_positive
  check (weight_grams is null or weight_grams > 0);

comment on column public.products.weight_grams is
  'Net weight in grams of the unit that `price` refers to. Retail = sold by kg: `price` is price-per-kg and the sold-by-kg basis is weight_grams=1000; fixed packs carry their literal net grams. Numeric source of truth replacing free-text data.weight/weightKg(). Read by the delivery weight-fee layer (M3) and byAmount grams derivation (M4). NULL allowed for wholesale / not-yet-set.';

-- 2) Backfill: cleanly-parseable sold-by-kg retail -> 1000 --------------------
-- Matches ONLY an unambiguous 1 kg listing ("1", "1 كيلو", "1 كجم"); every other
-- value (incl. "500", "25", "عرض مشكّل", bare letters) is excluded and handled
-- explicitly below.
update public.products
   set weight_grams = 1000
 where category = 'retail'
   and weight_grams is null
   and (data->'weight'->>'ar') ~ '^\s*1\s*(كيلو|كجم|كغ|kg)?\s*$';

-- 3) The two live mis-parses that stay visible -> 1000 (Qaari decision) -------
update public.products
   set weight_grams = 1000
 where id in (
   'e9b734f3-fed5-474e-88d5-9ec11565c025',  -- "لوززز ذماري"  (data.weight "500" -> was 500 kg)
   '1594de4a-314a-4d99-bdad-45eae4938e41'   -- "تجربة تجزئة"  (data.weight "عرض مشكّل", bundle)
 );

-- 4) Hide the four junk test rows (weight_grams left NULL) (Qaari decision) ----
update public.products
   set status = 'hidden'
 where status <> 'hidden'
   and id in (
   'e17b23b7-f337-4f16-9901-fb1608a96aca',  -- retail   "وو"  / weight "و"
   '378c34e3-c10b-4f16-a7e2-08fb5c63305f',  -- retail   "ق"   / weight "ف"  (price 2)
   '72fabeb0-2a27-42df-8fd0-5455c4802200',  -- wholesale "تجربة صورة المنتج" / weight "حبة البركة"
   '72757f62-98b5-465b-80b9-4b1c18c869c8'   -- wholesale "ل"   / weight "غ"  (price 2)
 );
