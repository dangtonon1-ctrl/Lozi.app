-- FIX 1: never trust client-supplied user_metadata.role. A public signUp could
-- set role:'wholesale' and self-grant wholesale visibility. Vendor roles are
-- authorised server-side in vendor_authorizations and delivered via verify-otp's
-- admin.createUser (which sets the VERIFIED auth.users.phone). Derive role from
-- there; everyone else — all public email/password sign-ups — is a customer.
--
-- Applied to live project niloddwnllhsvrmuxfxw on 2026-07-18 (see DEPLOYMENT_LOG.md).
--
-- SECURITY INVARIANT (intended, not incidental): a vendor role requires a
-- VERIFIED phone that matches the vendor_authorizations allowlist. The lookup
-- keys on auth.users.phone, which is set ONLY by phone-OTP verification (the
-- verify-otp flow's admin.createUser with phone_confirm) — never by an
-- email/password signup. Therefore an authorized vendor (their number IS in
-- vendor_authorizations) who signs up through the normal EMAIL flow has an empty
-- auth.users.phone and correctly lands as 'customer'. Knowing an authorized
-- number is not proof of owning it; unverified email signups must not inherit
-- vendor privileges. raw_user_meta_data->>'phone' (client-supplied, unverified)
-- is deliberately NOT consulted when deriving the role.
--
-- RECOVERY (known limitation → admin-panel open item): this trigger fires only
-- on INSERT. If such a user later verifies their phone on the same account, no
-- path re-grants the role — verify-otp's register branch finds the existing user
-- and issues a setup token without touching profiles.role, and there is no
-- update-time role sync. They stay 'customer' until an admin sets profiles.role
-- (profiles_admin_update). Tracked in mobile/OPEN_ITEMS.md; not built here.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role  text := 'customer';
  v_phone text := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
begin
  -- Vendor? Only if the VERIFIED phone (auth.users.phone) matches a
  -- server-provisioned authorization. auth.users.phone is populated solely by
  -- phone-OTP verification, so this can never be satisfied by an email signup.
  -- (auth.users.phone has no '+', vendor_authorizations.phone does → digits only.)
  if v_phone <> '' then
    select va.role into v_role
    from public.vendor_authorizations va
    where regexp_replace(va.phone, '[^0-9]', '', 'g') = v_phone
      and va.status in ('active','used')
    order by (va.status = 'active') desc
    limit 1;
    v_role := coalesce(v_role, 'customer');
  end if;

  insert into public.profiles (user_id, name, phone, role, default_crop, status, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
    coalesce(new.phone, new.raw_user_meta_data->>'phone'),  -- stored contact phone only; NOT used for role
    v_role,                                       -- server-derived, never client metadata
    new.raw_user_meta_data->>'default_crop',      -- crop is a non-privilege preference; unchanged
    'active',
    now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
