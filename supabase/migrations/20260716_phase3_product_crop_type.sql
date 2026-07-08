-- Phase 3.B — record the crop a product belongs to as products.crop_type
-- ('almond'|'raisin'), written alongside the category/vendor_role/market_segment
-- fields added in 3.A. Additive; existing rows keep crop_type = null.

alter table public.products add column if not exists crop_type text;

comment on column public.products.crop_type is
  'Farmer crop the product belongs to (''almond''|''raisin''); null for retail/wholesale vendors.';
