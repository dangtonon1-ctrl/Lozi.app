-- ============================================================================
-- ROLLBACK PRE-IMAGE for 20260737_products_weight_grams.sql
--
-- Reverts M2 to the exact pre-M2 live state (project niloddwnllhsvrmuxfxw):
--   * un-hides the four test rows M2 hid (all were status='available' before M2);
--   * drops the products_weight_grams_positive constraint and the weight_grams
--     column (removing every backfilled value).
-- M2 never modified data.weight, so nothing to restore there.
--
-- ORDER: if M3 (weight-fee) and/or M4 (byAmount) are applied, roll those back
-- FIRST -- they read products.weight_grams, so this DROP COLUMN would break them.
--
-- NOTE: the un-hide is unconditional back to 'available' -- run this ONLY to undo
-- M2. If any of the four rows were legitimately re-hidden after M2, re-hide them
-- afterward. Single transaction; no other objects touched; data.weight untouched.
-- ============================================================================

update public.products
   set status = 'available'
 where id in (
   'e17b23b7-f337-4f16-9901-fb1608a96aca',
   '378c34e3-c10b-4f16-a7e2-08fb5c63305f',
   '72fabeb0-2a27-42df-8fd0-5455c4802200',
   '72757f62-98b5-465b-80b9-4b1c18c869c8'
 );

alter table public.products drop constraint if exists products_weight_grams_positive;
alter table public.products drop column if exists weight_grams;
