-- ════════════════════════════════════════════════════════════════════════════
-- Rollback for 20260734_products_realtime_publication.
--
-- Restores the pre-change state exactly: re-grants anon the WRITE DML privileges
-- that the forward migration revoked on public.products, and removes products
-- from the `supabase_realtime` publication. Statements are the inverse of the
-- forward migration, applied in REVERSE order.
--
-- Note: the forward migration did NOT revoke anon SELECT, so this rollback does
-- NOT re-grant it (it was never removed — anon SELECT stayed intact throughout).
--
-- WARNING: applying this re-opens anon's latent WRITE DML grants on products
-- (RLS still denies anon writes — the own/admin policies require
-- auth.uid() = vendor_id or is_admin() — so no legitimate write path changes).
-- For disaster recovery / verification only. Removing the table from the
-- publication stops all live product/offer/savings updates.
-- ════════════════════════════════════════════════════════════════════════════

grant insert, update, delete on public.products to anon;   -- inverse (2)

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    execute 'alter publication supabase_realtime drop table public.products';
  end if;
end $$;                                                     -- inverse (1)
