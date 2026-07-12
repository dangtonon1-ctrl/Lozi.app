-- ════════════════════════════════════════════════════════════════════════════
-- Step 6 cleanup (1/2) — has_purchased_from → group-based review eligibility.
--
-- PROBLEM. A unified retail order stores ONE orders.seller_vendor_id (the
-- primary), but the real per-seller relationship lives in order_seller_groups
-- (one row per seller). The old rule keyed review eligibility off
-- orders.seller_vendor_id + orders.status, so a customer who bought from N
-- sellers in one unified order could review only the primary — and could
-- wrongly review the primary even if the primary's slice was rejected while the
-- order still delivered via the other sellers.
--
-- RULE (approved — the "UNION" rule). The customer may review seller S iff they
-- own a NON-REJECTED order_seller_groups row for S whose order reached the
-- customer:
--   * relationship + per-seller scope:  g.seller_id = p_vendor
--   * NOT rejected:  g.seller_decision <> 'rejected'
--                    AND g.fulfillment_status <> 'rejected_at_hub'
--   * delivered to customer:  o.status IN ('delivered','done')      -- authoritative
--                             OR g.fulfillment_status = 'delivered_to_customer'
--
-- WHY orders.status is the authoritative "delivered" signal. orders.status is
-- set by admin_set_order_status() (the customer lifecycle) while a group's
-- fulfillment_status='delivered_to_customer' is set by a SEPARATE admin action;
-- the two drift (e.g. live order 830586 is 'delivered' with its group still
-- 'out_for_delivery'). Keying "delivered" off orders.status keeps today's
-- semantics exactly (strict backward compat); the group delivered_to_customer
-- OR-branch is defensive/forward-compat (currently redundant, since every
-- delivered_to_customer group sits in a delivered order).
--
-- SCOPE. Single in-place CREATE OR REPLACE — same signature, volatility (STABLE),
-- SECURITY DEFINER, and search_path, so the ACL is preserved (authenticated =
-- EXECUTE, anon = none). No data is modified. The function is referenced by
-- exactly one object: the reviews_insert_own RLS WITH CHECK on public.reviews.
-- Because that is a WITH CHECK on INSERT, redefining the function cannot orphan
-- or re-validate any existing review row.
--
-- Pre-image: supabase/rollback/20260732_has_purchased_from_group_based_preimage.sql
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_purchased_from(p_vendor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_seller_groups g
    JOIN public.orders o ON o.id = g.order_id
    WHERE o.customer_id = auth.uid()
      AND g.seller_id   = p_vendor
      AND g.seller_decision    IS DISTINCT FROM 'rejected'   -- exclude seller-declined slice
      AND g.fulfillment_status <> 'rejected_at_hub'          -- exclude hub-rejected slice
      AND (
            o.status IN ('delivered', 'done')                    -- authoritative delivered signal
            OR g.fulfillment_status = 'delivered_to_customer'    -- defensive / forward-compat
          )
  );
$function$;
