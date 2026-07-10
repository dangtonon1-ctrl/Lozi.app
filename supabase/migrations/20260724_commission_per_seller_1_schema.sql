-- ============================================================================
-- Unified-cart Step 4a — per-seller commission: additive schema (server-only).
-- Adds authoritative per-group commission columns to order_seller_groups.
-- NOTHING reads or writes them yet (4b adds the engine, 4c wires it in).
-- No backfill: existing rows keep NULL/0, so every settled row is untouched.
-- Idempotent (add column / add constraint if not exists).
-- ============================================================================

alter table public.order_seller_groups
  add column if not exists commission_segment      text,
  add column if not exists commission_rate_applied numeric(6,4),
  add column if not exists commission_amount       numeric(14,2),
  add column if not exists cumulative_before       numeric(14,2),
  add column if not exists commission_state        text,
  add column if not exists reversed_amount         numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'osg_commission_state_chk'
                   and conrelid = 'public.order_seller_groups'::regclass) then
    alter table public.order_seller_groups
      add constraint osg_commission_state_chk
      check (commission_state is null
             or commission_state in ('charged','reversed','partially_reversed'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'osg_commission_segment_chk'
                   and conrelid = 'public.order_seller_groups'::regclass) then
    alter table public.order_seller_groups
      add constraint osg_commission_segment_chk
      check (commission_segment is null
             or commission_segment in ('retail','wholesale'));
  end if;
end $$;
