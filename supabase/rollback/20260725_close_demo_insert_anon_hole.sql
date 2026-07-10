-- ════════════════════════════════════════════════════════════════════════════
-- Rollback for 20260725_close_demo_insert_anon_hole.
--
-- Restores the pre-change state exactly: re-grants anon EXECUTE on the two helpers,
-- re-grants anon SELECT + INSERT on public.orders, and re-creates the always-true
-- `demo_insert` INSERT policy (PUBLIC, WITH CHECK true). Statements are the inverse
-- of the forward migration, applied in REVERSE order.
--
-- WARNING: applying this re-opens the anon-INSERT hole on public.orders. For
-- disaster recovery / verification only.
-- ════════════════════════════════════════════════════════════════════════════

grant  execute on function public.order_has_suspended_seller(jsonb, uuid) to anon;   -- inverse (c)
grant  execute on function public.is_seller_on_order(uuid)                to anon;   -- inverse (c)
grant  select on table public.orders to anon;                                        -- inverse (SELECT revoke)
grant  insert on table public.orders to anon;                                        -- inverse (b)
create policy demo_insert on public.orders for insert with check (true);             -- inverse (a)
