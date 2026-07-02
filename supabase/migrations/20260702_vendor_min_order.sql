-- ============================================================================
-- Lozi — Vendor-configurable minimum order amount (الحد الأدنى للطلب)
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-02. Idempotent.
--
-- A vendor may require a minimum cart subtotal (in YER) before a customer can
-- check out from their store, and may switch the requirement on/off.
--   min_order_amount  : the threshold in Yemeni Rial (nullable — no value set)
--   min_order_enabled : master switch; when false there is no minimum at all
-- Enforcement lives in the client (cart/checkout); these columns are the source
-- of truth the client reads via the stores select / browse feeds.
-- ============================================================================
alter table public.stores
  add column if not exists min_order_amount  numeric,
  add column if not exists min_order_enabled boolean not null default false;
