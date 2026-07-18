-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ ⏳ DRAFT — NOT YET APPLIED to any environment.                            │
-- │ FIX 1 is gated on explicit, separate human approval before apply.        │
-- │ Do NOT run via `supabase db push` / auto-migrate until approved.         │
-- │ (schema_migrations does NOT contain this version yet — see               │
-- │  DEPLOYMENT_LOG.md, "FIX 1 … DRAFTED, NOT APPLIED".)                      │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- FIX 1: never trust client-supplied user_metadata.role. A public signUp could
-- set role:'wholesale' and self-grant wholesale visibility. Vendor roles are
-- authorised server-side in vendor_authorizations and delivered via verify-otp's
-- admin.createUser (which sets the verified auth.users.phone). Derive role from
-- there; everyone else — all public email/password sign-ups — is a customer.
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
  -- Vendor? Only if the VERIFIED phone matches a server-provisioned authorization.
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
    coalesce(new.phone, new.raw_user_meta_data->>'phone'),
    v_role,                                       -- server-derived, never client metadata
    new.raw_user_meta_data->>'default_crop',      -- crop is a non-privilege preference; unchanged
    'active',
    now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
