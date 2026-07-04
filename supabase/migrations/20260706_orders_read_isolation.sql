-- Security fix: orders were world-readable to any authenticated user.
--
-- A leftover `demo_read` policy on public.orders used `USING (true)`, so ANY
-- logged-in user (e.g. a seller, or any account) could SELECT every order row —
-- including each buyer's delivery/checkout details stored in the `customer`
-- column. This violates the isolation requirement that a seller must never be
-- able to read a buyer's checkout details.
--
-- The correct, scoped SELECT policies already exist and fully cover every
-- legitimate read path used by the app:
--   orders_customer_read : auth.uid() = customer_id       (buyer sees own orders)
--   orders_seller_read   : auth.uid() = seller_vendor_id  (seller sees own orders)
--   orders_admin         : is_admin()                     (admin oversight)
-- All client reads are already scoped by customer_id or seller_vendor_id, so
-- dropping the broad policy removes only the over-exposure, nothing legitimate.
--
-- Applied to project niloddwnllhsvrmuxfxw.

drop policy if exists demo_read on public.orders;
