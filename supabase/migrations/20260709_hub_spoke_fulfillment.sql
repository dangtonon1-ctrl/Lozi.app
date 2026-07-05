-- ════════════════════════════════════════════════════════════════════════════
-- Lozi — "Hub & Spoke" fulfillment + direct seller payout (v2)
--
-- Deliver-and-inspect model, no digital wallet: the customer pays in-app, the
-- seller brings goods to the central hub (بيت المكسرات), an admin inspects and
-- pays the seller (cash / transfer), then last-mile delivery closes the loop.
-- This migration adds a per-seller "seller group" that tracks that supply-side
-- lifecycle and records the payout.
--
-- Ground truth of THIS database (inspected 2026-07-05):
--   • Sellers are public.profiles (PK user_id); phone in profiles.phone (+9677…).
--   • Orders are single-seller: orders.seller_vendor_id. Line items live in the
--     jsonb column orders.items shaped {p, q, name, price, weight} (some `p` are
--     synthetic 'rfq-…' ids, not products).
--   • The public.order_items table is currently empty/unused.
--   • Commission is ALREADY charged by the existing engine when orders.status
--     becomes 'delivered' (charge_commission → advances
--     profiles.retail/wholesale_cumulative_sales, snapshots orders.commission_*,
--     reverse_commission zero-floor on cancel/return).
--
-- Confirmed commission_tiers schema (single source of truth for level/rate):
--   id bigint, segment text CHECK in ('retail','wholesale'), level int (1..7),
--   min_sales numeric, max_sales numeric (NULL = infinity), rate numeric
--   (fraction, e.g. 1.50% = 0.0150). Existing lookup:
--     public.get_tier(p_segment text, p_cumulative numeric)
--       returns (level, rate, min_sales, max_sales).
--   Per-seller cumulative counters:
--     profiles.retail_cumulative_sales / profiles.wholesale_cumulative_sales.
--
-- DESIGN DECISION (confirmed): the hub inspection is READ-ONLY with respect to
-- commission. It computes and stores a platform_commission / seller_net_amount
-- snapshot on the seller-group for payout display, but it does NOT advance the
-- cumulative counter and does NOT touch orders.commission_*. The existing
-- delivered-time engine stays the single source of truth for the counter and
-- reversals, so nothing is double-counted.
--
-- Idempotent: safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Enums ────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'order_fulfillment_status') then
    create type public.order_fulfillment_status as enum (
      'paid_by_customer',
      'pending_hub_delivery',
      'inspected_and_received',
      'rejected_at_hub',
      'out_for_delivery',
      'delivered_to_customer',
      'returned_by_customer',
      'disputed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'seller_payout_status') then
    create type public.seller_payout_status as enum (
      'pending',
      'paid_cash',
      'paid_transfer',
      'withheld_disputed'
    );
  end if;
end $$;

-- ── 2. order_items.seller_id (spec Step 1.2) ────────────────────────────────
-- The table is empty today, so the backfill is a no-op; the column is added for
-- forward-compat so any future normalized line-item writing can group by seller.
alter table public.order_items
  add column if not exists seller_id uuid references public.profiles(user_id);

update public.order_items oi
   set seller_id = coalesce(
     (select p.vendor_id      from public.products p where p.id = oi.product_id),
     (select o.seller_vendor_id from public.orders  o where o.id = oi.order_id))
 where oi.seller_id is null;

-- ── 3. order_seller_groups (per-seller supply/payout tracking) ──────────────
create table if not exists public.order_seller_groups (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  seller_id            uuid references public.profiles(user_id),
  seller_phone         text,                                   -- snapshot at order time
  subtotal_amount      numeric(14,2) not null default 0,       -- this seller's line items only
  fulfillment_status   public.order_fulfillment_status not null default 'paid_by_customer',
  seller_payout_status public.seller_payout_status     not null default 'pending',
  hub_received_at      timestamptz,
  inspector_notes      text,
  payout_reference     text,
  platform_commission  numeric(14,2),                          -- read-only snapshot (see header)
  seller_net_amount    numeric(14,2),
  delivery_fee_yer     numeric(14,2) not null default 0,       -- 1000 per seller-group at inspection
  created_at           timestamptz not null default now(),
  unique (order_id, seller_id)
);
create index if not exists osg_order_idx  on public.order_seller_groups(order_id);
create index if not exists osg_seller_idx on public.order_seller_groups(seller_id);
create index if not exists osg_status_idx on public.order_seller_groups(fulfillment_status);

-- ── 4. get_commission_rate — thin lookup on top of commission_tiers/get_tier ─
-- Reads the seller's current per-channel cumulative counter (unless an explicit
-- cumulative is passed) and returns the applicable tier rate. SECURITY DEFINER
-- so it can read the counter regardless of the caller's RLS. READ-ONLY.
-- Locked to the owner context: only the inspection trigger (itself SECURITY
-- DEFINER) calls it. Execute is revoked from anon/authenticated so an untrusted
-- client cannot use it to read an arbitrary seller's cumulative-sales figure —
-- the admin UI derives the same rate client-side from get_tier + the counter.
create or replace function public.get_commission_rate(
  p_seller_id uuid, p_sale_channel text, p_cumulative_total numeric default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
    select t.rate
    from public.get_tier(
      case when p_sale_channel = 'wholesale' then 'wholesale' else 'retail' end,
      coalesce(
        p_cumulative_total,
        case when p_sale_channel = 'wholesale'
             then (select wholesale_cumulative_sales from public.profiles where user_id = p_seller_id)
             else (select retail_cumulative_sales    from public.profiles where user_id = p_seller_id)
        end,
        0)
    ) t
  ), 0);
$$;
revoke all on function public.get_commission_rate(uuid, text, numeric) from public, anon, authenticated;

-- ── 5. Inspection trigger (BEFORE UPDATE OF fulfillment_status) ─────────────
-- Fires when a group moves pending_hub_delivery → inspected_and_received:
-- stamps hub_received_at, computes a READ-ONLY commission/net snapshot, charges
-- the 1000 YER delivery fee once for this seller-group, and auto-advances to
-- out_for_delivery. Does NOT advance the cumulative counter (see header).
-- rejected_at_hub (and every other transition) leaves commission/payout alone.
create or replace function public.osg_on_inspect()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text; v_rate numeric;
begin
  if OLD.fulfillment_status = 'pending_hub_delivery'
     and NEW.fulfillment_status = 'inspected_and_received' then
    select coalesce(o.segment, public.resolve_order_segment(o.items, o.seller_vendor_id), 'retail')
      into v_channel
      from public.orders o
     where o.id = NEW.order_id;

    v_rate := public.get_commission_rate(NEW.seller_id, coalesce(v_channel, 'retail'), null);

    NEW.hub_received_at     := now();
    NEW.platform_commission := round(coalesce(NEW.subtotal_amount, 0) * coalesce(v_rate, 0), 2);
    NEW.seller_net_amount   := round(coalesce(NEW.subtotal_amount, 0) - NEW.platform_commission, 2);
    NEW.delivery_fee_yer    := 1000;                        -- per seller-group
    NEW.fulfillment_status  := 'out_for_delivery';          -- auto-advance past inspected
  end if;
  return NEW;
end $$;
revoke all on function public.osg_on_inspect() from public, anon, authenticated;

drop trigger if exists trg_osg_on_inspect on public.order_seller_groups;
create trigger trg_osg_on_inspect
  before update of fulfillment_status on public.order_seller_groups
  for each row execute function public.osg_on_inspect();

-- ── 6. Group sync — one group per distinct seller from orders.items ─────────
-- Splits an order's jsonb items into per-seller subtotals (multi-seller ready;
-- single-seller today). A uuid-shaped `p` resolves to products.vendor_id, else
-- it falls back to orders.seller_vendor_id (covers 'rfq-…' synthetic ids).
-- INSERT … ON CONFLICT DO NOTHING preserves any admin edits on existing rows.
create or replace function public.sync_order_seller_groups(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; r record;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return; end if;

  for r in
    with items as (
      select
        coalesce(
          case when (it->>'p') ~ '^[0-9a-fA-F-]{36}$'
               then (select p.vendor_id from public.products p where p.id = (it->>'p')::uuid)
          end,
          o.seller_vendor_id) as sid,
        (coalesce((it->>'price')::numeric, 0) * coalesce((it->>'q')::numeric, 0)) as line
      from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it
    )
    select sid, round(sum(line), 2) as subtotal
    from items
    where sid is not null
    group by sid
  loop
    insert into public.order_seller_groups (order_id, seller_id, seller_phone, subtotal_amount)
    values (p_order_id, r.sid,
            (select phone from public.profiles where user_id = r.sid),
            r.subtotal)
    on conflict (order_id, seller_id) do nothing;
  end loop;

  -- Fallback: an order with no resolvable seller/items still gets one group.
  if not exists (select 1 from public.order_seller_groups where order_id = p_order_id) then
    insert into public.order_seller_groups (order_id, seller_id, seller_phone, subtotal_amount)
    values (p_order_id, o.seller_vendor_id,
            (select phone from public.profiles where user_id = o.seller_vendor_id),
            coalesce(o.goods_subtotal, coalesce(o.total, 0) - coalesce(o.delivery_fee, 0), 0))
    on conflict (order_id, seller_id) do nothing;
  end if;
end $$;
revoke all on function public.sync_order_seller_groups(uuid) from public, anon, authenticated;

-- New orders auto-create their seller group(s) in the default paid_by_customer
-- state (admin then confirms payment → pending_hub_delivery in the dashboard).
create or replace function public.orders_make_groups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_order_seller_groups(NEW.id);
  return NEW;
end $$;
revoke all on function public.orders_make_groups() from public, anon, authenticated;

drop trigger if exists trg_orders_make_groups on public.orders;
create trigger trg_orders_make_groups
  after insert on public.orders
  for each row execute function public.orders_make_groups();

-- ── 7. Backfill existing orders ─────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select id from public.orders loop
    perform public.sync_order_seller_groups(r.id);
  end loop;

  -- Map historical fulfillment_status from the customer-facing order status so
  -- the hub dashboard is not clogged with already-finished orders. Only rows
  -- still at the freshly-created default are touched (re-run safe).
  update public.order_seller_groups g
     set fulfillment_status = case o.status
           when 'delivered'  then 'delivered_to_customer'::public.order_fulfillment_status
           when 'delivering' then 'out_for_delivery'::public.order_fulfillment_status
           when 'preparing'  then 'pending_hub_delivery'::public.order_fulfillment_status
           else 'paid_by_customer'::public.order_fulfillment_status
         end
    from public.orders o
   where o.id = g.order_id
     and g.fulfillment_status = 'paid_by_customer';

  -- Mirror the existing commission snapshot onto delivered groups (display only;
  -- payout status stays 'pending' and the counter is untouched).
  update public.order_seller_groups g
     set platform_commission = o.commission_amount,
         seller_net_amount   = round(g.subtotal_amount - coalesce(o.commission_amount, 0), 2),
         delivery_fee_yer    = coalesce(o.delivery_fee, g.delivery_fee_yer),
         hub_received_at     = coalesce(g.hub_received_at, o.created_at)
    from public.orders o
   where o.id = g.order_id
     and o.status = 'delivered'
     and o.commission_amount is not null
     and g.platform_commission is null;
end $$;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
-- Only admin may write fulfillment/payout columns; sellers & customers get
-- SELECT on their own rows only (no write policy ⇒ every write is denied).
alter table public.order_seller_groups enable row level security;

drop policy if exists osg_admin on public.order_seller_groups;
create policy osg_admin on public.order_seller_groups for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists osg_seller_read on public.order_seller_groups;
create policy osg_seller_read on public.order_seller_groups for select to authenticated
  using (auth.uid() = seller_id);

drop policy if exists osg_customer_read on public.order_seller_groups;
create policy osg_customer_read on public.order_seller_groups for select to authenticated
  using (exists (select 1 from public.orders o
                  where o.id = order_id and o.customer_id = auth.uid()));

-- ── 9. Hub address (admin-editable, not hardcoded) ──────────────────────────
insert into public.settings (key, value) values ('hub_address', 'بيت المكسرات')
on conflict (key) do nothing;

-- ── Step 2 (Cloudflare Worker) is DEFERRED ──────────────────────────────────
-- There is no live payment gateway yet; 'paid_by_customer' is set manually and
-- the admin advances paid_by_customer → pending_hub_delivery from the dashboard.
-- When a real gateway is integrated, the worker that mutates order status MUST
-- verify the webhook signature/secret first — never trust an unauthenticated
-- POST (see the hardcoded-PIN/backdoor findings in the security audit).
