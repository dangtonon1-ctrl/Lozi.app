-- Account deletion requests (self-serve request; admin handles the removal).
-- Fixes the runtime error "Could not find the table 'public.deletion_requests'".
create table if not exists public.deletion_requests (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text,
  name       text,
  phone      text,
  email      text,
  status     text not null default 'pending' check (status in ('pending','handled')),
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.deletion_requests enable row level security;

-- A signed-in user may create/refresh and read their own request.
drop policy if exists deletion_requests_own_upsert on public.deletion_requests;
create policy deletion_requests_own_upsert on public.deletion_requests
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists deletion_requests_own_update on public.deletion_requests;
create policy deletion_requests_own_update on public.deletion_requests
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists deletion_requests_own_read on public.deletion_requests;
create policy deletion_requests_own_read on public.deletion_requests
  for select to authenticated using (auth.uid() = user_id);

-- Admins manage all requests.
drop policy if exists deletion_requests_admin on public.deletion_requests;
create policy deletion_requests_admin on public.deletion_requests
  for all using (public.is_admin()) with check (public.is_admin());
