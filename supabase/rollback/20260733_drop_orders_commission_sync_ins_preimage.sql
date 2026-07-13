-- Pre-image for 20260733_drop_orders_commission_sync_ins.
-- Re-creates the dormant AFTER INSERT commission hook exactly as it was live
-- before the drop (function body + trigger + ACL). Captured from prod
-- niloddwnllhsvrmuxfxw. Re-creation is trivial — one function + one trigger.

CREATE OR REPLACE FUNCTION public.orders_commission_sync_ins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.status = 'delivered' and NEW.commission_state is null then
    perform public.charge_commission(NEW.id);
  end if;
  return NEW;
end;
$function$;

REVOKE ALL ON FUNCTION public.orders_commission_sync_ins() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_commission_sync_ins ON public.orders;
CREATE TRIGGER trg_orders_commission_sync_ins
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_commission_sync_ins();
