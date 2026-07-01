-- Lock name & phone for VENDOR accounts at the data-of-record (public.profiles).
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-01. Idempotent.
--
-- Gates on the actual STORED role (not UI state): any role other than 'customer'
-- is a vendor (farmer / farmer_almond / farmer_raisin / retail / wholesale).
-- Customers are never affected — they keep full edit ability. Platform admins
-- (and internal service-role writes, where auth.uid() is null) may still correct
-- the data, matching the product rule "a vendor phone/name change goes through a
-- platform admin request, not self-service".
--
-- public.profiles already has no self-update RLS policy, so a vendor cannot
-- update the row via the API at all; this trigger is explicit, role-gated
-- defence-in-depth so the rule still holds if an update policy is ever added.
create or replace function public.lock_vendor_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Customers keep full edit ability.
  if OLD.role is null or OLD.role = 'customer' then
    return NEW;
  end if;
  -- Only enforce when the locked fields actually change.
  if NEW.name is not distinct from OLD.name
     and NEW.phone is not distinct from OLD.phone then
    return NEW;
  end if;
  -- Admins / internal service-role writes may still correct identity data.
  if public.is_admin() or auth.uid() is null then
    return NEW;
  end if;
  raise exception 'vendor name and phone are locked; changes require a platform admin'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists lock_vendor_profile_identity on public.profiles;
create trigger lock_vendor_profile_identity
  before update on public.profiles
  for each row execute function public.lock_vendor_profile_identity();

-- Trigger function must never be callable directly via PostgREST RPC; the
-- trigger still fires on DML regardless of these grants.
revoke execute on function public.lock_vendor_profile_identity() from public, anon, authenticated;
