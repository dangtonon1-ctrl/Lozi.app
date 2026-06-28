-- Allow admins to write to the public.settings table.
-- Previously the table only had a public SELECT policy, so any INSERT
-- (e.g. saving a brand-new key such as retail_bundle_limit) was blocked by
-- RLS with "new row violates row-level security policy". Existing keys could
-- not be updated either. Admins are users whose id is present in public.admins.

drop policy if exists settings_admin_insert on public.settings;
drop policy if exists settings_admin_update on public.settings;

create policy settings_admin_insert on public.settings
  for insert to authenticated
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy settings_admin_update on public.settings
  for update to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
