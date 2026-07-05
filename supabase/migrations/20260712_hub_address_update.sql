-- Update the central hub (goods supply) delivery address that appears in the
-- seller "ready for supply" (جاهز للتوريد) notifications.
--
-- The address is a proper editable field (public.settings key='hub_address'),
-- editable at any time from the admin settings screen — never hardcoded and
-- never write-once. This migration only corrects the STALE seeded default
-- ('بيت المكسرات') to the current full address. The `value = 'بيت المكسرات'`
-- guard makes it idempotent AND safe: it will never clobber a value an admin
-- has since edited to something else.
update public.settings
   set value = 'شارع خولان - أمام المطعم الملكي - وكالة بيت المكسرات',
       updated_at = now()
 where key = 'hub_address'
   and value = 'بيت المكسرات';

-- Ensure the row exists for fresh installs (does not overwrite an existing one).
insert into public.settings (key, value)
values ('hub_address', 'شارع خولان - أمام المطعم الملكي - وكالة بيت المكسرات')
on conflict (key) do nothing;
