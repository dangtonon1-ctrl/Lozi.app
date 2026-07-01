-- Neutralize the GoTrue self-service vector for VENDOR accounts: block changes
-- to the auth-layer phone and to the display name held in user_metadata
-- (name / full_name / metadata phone). Applied to project niloddwnllhsvrmuxfxw
-- on 2026-07-01. Idempotent. Gates on the STORED role in public.profiles
-- (anything other than 'customer' is a vendor).
--
-- SAFETY: this BEFORE UPDATE trigger NEVER raises. It fast-paths out when the
-- locked fields are unchanged (logins, token refresh, password resets, etc.) and
-- otherwise SILENTLY REVERTS the locked fields to their old values. Worst case
-- it is a no-op — it can never break authentication for any user. The first-time
-- name assignment during vendor registration (old name empty) is allowed. A
-- deliberate admin/manual change can opt out for one transaction with:
--   set local lozi.allow_identity_change = 'on';
create or replace function public.lock_vendor_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  old_name text := coalesce(OLD.raw_user_meta_data->>'name', OLD.raw_user_meta_data->>'full_name');
  new_name text := coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name');
begin
  -- Fast path: nothing identity-related changed.
  if NEW.phone is not distinct from OLD.phone
     and new_name is not distinct from old_name
     and (NEW.raw_user_meta_data->>'phone') is not distinct from (OLD.raw_user_meta_data->>'phone') then
    return NEW;
  end if;
  -- Explicit admin/manual override for this transaction.
  if coalesce(current_setting('lozi.allow_identity_change', true), '') = 'on' then
    return NEW;
  end if;
  select role into v_role from public.profiles where user_id = NEW.id;
  if v_role is null or v_role = 'customer' then
    return NEW;  -- customers unaffected
  end if;

  -- Vendor account: revert locked-field changes (allow first-time name set).
  if new_name is distinct from old_name and coalesce(old_name, '') <> '' then
    NEW.raw_user_meta_data := jsonb_set(
      jsonb_set(coalesce(NEW.raw_user_meta_data, '{}'::jsonb),
                '{name}',      coalesce(OLD.raw_user_meta_data->'name',      'null'::jsonb), true),
      '{full_name}',          coalesce(OLD.raw_user_meta_data->'full_name', 'null'::jsonb), true);
  end if;
  if NEW.phone is distinct from OLD.phone then
    NEW.phone := OLD.phone;
  end if;
  if (NEW.raw_user_meta_data->>'phone') is distinct from (OLD.raw_user_meta_data->>'phone') then
    NEW.raw_user_meta_data := jsonb_set(coalesce(NEW.raw_user_meta_data, '{}'::jsonb),
                '{phone}', coalesce(OLD.raw_user_meta_data->'phone', 'null'::jsonb), true);
  end if;
  return NEW;
end;
$$;

drop trigger if exists lock_vendor_auth_identity on auth.users;
create trigger lock_vendor_auth_identity
  before update on auth.users
  for each row execute function public.lock_vendor_auth_identity();

-- Trigger function must never be callable directly via PostgREST RPC; the
-- trigger still fires on DML regardless of these grants.
revoke execute on function public.lock_vendor_auth_identity() from public, anon, authenticated;
