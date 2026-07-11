-- ════════════════════════════════════════════════════════════════════════════
-- Rollback for 20260726_orders_realtime_publication.
--
-- Restores the pre-change state exactly: removes the two order tables from the
-- `supabase_realtime` publication, and re-grants anon the DML privileges that
-- the forward migration revoked on public.order_seller_groups. Statements are
-- the inverse of the forward migration, applied in REVERSE order.
--
-- WARNING: applying this re-opens anon's latent DML grants on
-- order_seller_groups (RLS still denies anon — no anon policy exists — so no
-- legitimate read/write path changes). For disaster recovery / verification
-- only. Removing the tables from the publication stops all live order updates.
-- ════════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on public.order_seller_groups to anon;   -- inverse (2)

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_seller_groups'
  ) then
    execute 'alter publication supabase_realtime drop table public.order_seller_groups';
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime drop table public.orders';
  end if;
end $$;                                                                        -- inverse (1)
