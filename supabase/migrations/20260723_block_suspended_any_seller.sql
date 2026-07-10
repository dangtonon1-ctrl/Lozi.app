-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 3c — block checkout if ANY seller in the order is suspended.
--
-- Before: orders_block_suspended_seller WITH CHECK (NOT is_suspended(seller_vendor_id))
-- only checked the single primary seller. A future multi-seller cart could slip a
-- suspended SECONDARY seller through.
--
-- At INSERT time the order_seller_groups rows don't exist yet (the AFTER INSERT
-- trigger builds them), so the check must resolve sellers from NEW.items, using the
-- SAME resolution as sync_order_seller_groups (uuid items[].p → products.vendor_id,
-- else fall back to seller_vendor_id). A SECURITY DEFINER helper does the enumeration
-- so the products lookup is not weakened by the caller's RLS, and it ALWAYS includes
-- the fallback seller so the new check can never pass something the old one blocked.
--
-- Backward-compatible: on a single-seller cart the resolved seller set collapses to
-- {seller_vendor_id}, so the helper == is_suspended(seller_vendor_id). Multi-seller
-- carts (none today) now block if ANY of their sellers is suspended.
--
-- Grants mirror is_suspended (authenticated + service_role, not public/anon) so the
-- INSERT policy can evaluate the helper as the calling role.
--
-- IMPORTANT: the policy is recreated AS RESTRICTIVE, exactly as it is today. A
-- restrictive INSERT policy is AND-ed with the permissive ones (orders_insert,
-- demo_insert), so it genuinely blocks; a bare (permissive) policy would be OR-ed and
-- therefore never block. Preserving RESTRICTIVE is essential.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.order_has_suspended_seller(p_items jsonb, p_fallback uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from (
      select distinct sid
      from (
        -- resolve each line item to its seller (uuid product → vendor, else fallback)
        select coalesce(
                 case when (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
                      then (select pr.vendor_id from public.products pr where pr.id = (it->>'p')::uuid)
                 end,
                 p_fallback) as sid
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) it
        union all
        select p_fallback              -- fallback is always a candidate
      ) u
      where sid is not null
    ) s
    where public.is_suspended(s.sid)
  );
$$;
revoke all on function public.order_has_suspended_seller(jsonb, uuid) from public;
grant  execute on function public.order_has_suspended_seller(jsonb, uuid) to authenticated, service_role;

drop policy if exists orders_block_suspended_seller on public.orders;
create policy orders_block_suspended_seller on public.orders as restrictive for insert
  with check (not public.order_has_suspended_seller(items, seller_vendor_id));
