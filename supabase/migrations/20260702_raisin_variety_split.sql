-- ============================================================================
-- Lozi — Split the combined raisin variety «بياض اسود» into two separate types.
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-02. Idempotent.
--
-- Raisin varieties become three separate types (parallel to almond's three):
--   razqi  — رازقي  (Razqi)   — kept as-is
--   bayad  — بياض   (White)   — new (was half of the combined button)
--   aswad  — أسود   (Black)   — new (was half of the combined button)
-- No raisin products existed at migration time; the UPDATE is a defensive
-- best-effort remap of any stray listing to أسود.
-- ============================================================================

update public.products
   set data = jsonb_set(data, '{variety}', '"aswad"')
 where category = 'raisin' and data->>'variety' = 'bayad_aswad';

delete from public.section_varieties
 where section = 'raisin' and variety_id = 'bayad_aswad';

insert into public.section_varieties (section, variety_id, label_ar, label_en, sort) values
  ('raisin','bayad', 'بياض', 'White', 2),
  ('raisin','aswad', 'أسود', 'Black', 3)
on conflict (section, variety_id) do update
  set label_ar = excluded.label_ar, label_en = excluded.label_en, sort = excluded.sort;
