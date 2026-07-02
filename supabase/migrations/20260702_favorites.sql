-- Per-user product favorites (المفضلة).
--
-- Before this, favorites lived only in client state — seeded with two fake product ids
-- ("p2","p5") that always rendered as placeholders, and never persisted anywhere. Adding a
-- real product did nothing durable, so the favorites page could never reflect it.
--
-- product_id is TEXT (not a FK) because it must hold both real products.id UUIDs and the
-- client-side seed ids, and a favorite should survive a product being removed.

create table if not exists public.favorites (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  product_id text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id);

alter table public.favorites enable row level security;

-- Each user may only see and manage their own favorites.
drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites
  for select using (auth.uid() = user_id);

drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites
  for insert with check (auth.uid() = user_id);

drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites
  for delete using (auth.uid() = user_id);
