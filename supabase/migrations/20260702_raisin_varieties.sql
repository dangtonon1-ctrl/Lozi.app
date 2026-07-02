-- ============================================================================
-- Lozi — Replace raisin (الزبيب) subtype options with the two approved choices.
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-02. Idempotent.
--
-- Old raisin varieties: ahmar (أحمر), aswad (أسود), akhdar (أخضر).
-- New raisin varieties (the only two allowed going forward):
--   razqi        — رازقي        (Razqi)
--   bayad_aswad  — بياض اسود     (Black & White)
--
-- No raisin products existed at migration time (verified), so there is no data
-- to lose. The UPDATE statements below are a defensive best-effort mapping in
-- case a listing exists on another environment: the black variety maps to the
-- black/white option; red & green (no clean equivalent) map to razqi.
-- section_varieties is the single data-driven source the filter UI, the add
-- product form and the product page all read from.
-- ============================================================================

-- 1. Best-effort remap of any existing raisin listings (no-op when none exist).
update public.products
   set data = jsonb_set(data, '{variety}', '"bayad_aswad"')
 where category = 'raisin' and data->>'variety' = 'aswad';
update public.products
   set data = jsonb_set(data, '{variety}', '"razqi"')
 where category = 'raisin' and data->>'variety' in ('ahmar', 'akhdar');

-- 2. Remove the retired raisin varieties.
delete from public.section_varieties
 where section = 'raisin' and variety_id in ('ahmar', 'aswad', 'akhdar');

-- 3. Install the two approved raisin varieties.
insert into public.section_varieties (section, variety_id, label_ar, label_en, sort) values
  ('raisin','razqi',       'رازقي',     'Razqi',         1),
  ('raisin','bayad_aswad', 'بياض اسود', 'Black & White', 2)
on conflict (section, variety_id) do update
  set label_ar = excluded.label_ar, label_en = excluded.label_en, sort = excluded.sort;
