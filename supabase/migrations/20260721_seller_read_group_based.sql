-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 3a — make the seller READ policy group-based.
--
-- Before: orders_seller_read USING (auth.uid() = seller_vendor_id) — only the ONE
-- primary seller of an order could read the base row. A future multi-seller order's
-- SECONDARY seller (who owns an order_seller_groups row but is not seller_vendor_id)
-- was denied at the RLS layer.
--
-- This also unblocks Step 1: orders_seller_facing is security_invoker, so a secondary
-- seller currently passes the view's group-membership WHERE yet is still denied by
-- THIS base-row policy. Group-basing it is what actually lets the view expose the
-- order to a secondary seller.
--
-- New: a seller may read an order iff they own one of its seller-groups.
--
-- ── Why a SECURITY DEFINER helper (not an inline EXISTS subquery) ────────────
-- order_seller_groups has an RLS policy (osg_customer_read, from Step 1) whose USING
-- reads back public.orders. If orders_seller_read inlined a subquery over
-- order_seller_groups, evaluating it would invoke order_seller_groups' RLS, which
-- reads orders, which re-invokes orders_seller_read … → Postgres raises
-- "infinite recursion detected in policy for relation orders". Wrapping the
-- membership test in a SECURITY DEFINER function makes its read of order_seller_groups
-- run as the owner (RLS bypassed), breaking the cycle. The function only ever tests
-- the CALLER's own membership (seller_id = auth.uid()), so it leaks nothing.
--
-- Backward-compatible: on the 17 single-seller orders (group.seller_id ==
-- seller_vendor_id, one group each) membership ⇔ auth.uid()=seller_vendor_id, so
-- access is identical. A seller with NO group is still fully denied. The live client
-- additionally filters .eq('seller_vendor_id', uid), so nothing it sees changes until
-- the 2c cutover removes that filter.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.is_seller_on_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.order_seller_groups g
    where g.order_id = p_order_id and g.seller_id = auth.uid()
  );
$$;
revoke all on function public.is_seller_on_order(uuid) from public;
grant  execute on function public.is_seller_on_order(uuid) to authenticated, service_role;

drop policy if exists orders_seller_read on public.orders;
create policy orders_seller_read on public.orders for select to authenticated
  using (public.is_seller_on_order(id));
