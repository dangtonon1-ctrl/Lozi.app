-- Phase 3.B — store a farmer's chosen crop as profiles.default_crop, mirroring
-- how role is carried: written into auth user_metadata at account creation and
-- copied into public.profiles by the handle_new_user trigger. Additive only;
-- the farmer_almond/farmer_raisin coercion shim stays active this phase.

alter table public.profiles add column if not exists default_crop text;

comment on column public.profiles.default_crop is
  'Farmer''s default crop (''almond''|''raisin''); mirrors auth user_metadata.default_crop.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (user_id, name, phone, role, default_crop, status, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
    coalesce(new.raw_user_meta_data->>'phone', new.phone),
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    new.raw_user_meta_data->>'default_crop',
    'active',
    now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
