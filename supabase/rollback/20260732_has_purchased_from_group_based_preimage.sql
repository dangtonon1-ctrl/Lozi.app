-- Pre-image for 20260732_has_purchased_from_group_based.
-- Restores the exact seller_vendor_id-based has_purchased_from that was live
-- immediately before the group-based rewrite. Single in-place CREATE OR REPLACE
-- (same signature/volatility/security/search_path) → ACL is preserved
-- (authenticated = EXECUTE, anon = none). Captured from prod niloddwnllhsvrmuxfxw.

CREATE OR REPLACE FUNCTION public.has_purchased_from(p_vendor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.customer_id = auth.uid()
      AND o.seller_vendor_id = p_vendor
      AND o.status IN ('delivered', 'done')
  );
$function$;
