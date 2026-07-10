-- ════════════════════════════════════════════════════════════════════════════
-- Unified-cart Step 2a — per-seller accept/reject: ADDITIVE SCHEMA ONLY.
--
-- Adds an orthogonal "seller decision" dimension to order_seller_groups so each
-- seller can later accept or reject THEIR OWN slice of a (future) multi-seller
-- order, independently of the supply/location lifecycle already tracked by
-- fulfillment_status. This migration adds columns + a backfill ONLY — no function,
-- view, RPC or policy changes, and nothing reads these columns yet, so behavior is
-- byte-for-byte unchanged. Step 2b wires the logic.
--
-- Design (approved):
--   • seller_decision is SEPARATE from fulfillment_status. fulfillment_status keeps
--     meaning "where are the goods" (paid_by_customer → … → delivered_to_customer,
--     plus the admin-side rejected_at_hub). seller_decision means "did this seller
--     agree to fulfil": pending / accepted / rejected. 'accepted' ≈ today's moment
--     of pressing بدء التجهيز; 'rejected' = the seller declining before sending.
--     This is deliberately NOT reusing rejected_at_hub (that is the admin's
--     inspection reject) and NOT new fulfillment_status enum values.
--   • The manual-refund flag lives on the SAME group row (no new table): when a
--     seller rejects, Step 2b records the amount owed back to the customer
--     (rejected goods subtotal + the delivery-fee difference for the remaining
--     sellers) and a refund_status the admin panel can action. Auto-refund is NEVER
--     performed — the admin settles it by hand, mirroring the existing hub/payout
--     controls that already read order_seller_groups directly.
--
-- Backfill (single-seller today; every order has exactly one group):
--   status = 'rejected'      → seller_decision 'rejected'  (a seller already declined)
--   rank(status) >= 1        → seller_decision 'accepted'  (preparing/delivering/delivered)
--   otherwise (new/received/ → seller_decision 'pending'
--     payreview/cancelled)
-- so that Step 2b's status-derivation, if ever invoked on today's rows, reproduces
-- exactly the current orders.status.
--
-- Idempotent: safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columns (additive; NOT NULL default keeps existing rows valid) ────────
alter table public.order_seller_groups
  add column if not exists seller_decision          text not null default 'pending',
  add column if not exists decided_at               timestamptz,
  add column if not exists decline_reason           text,
  add column if not exists refund_rejected_subtotal numeric(14,2),   -- rejected seller's goods
  add column if not exists refund_fee_diff          numeric(14,2),   -- delivery-fee owed back
  add column if not exists refund_owed_yer          numeric(14,2),   -- total owed to customer
  add column if not exists refund_status            text;            -- null | pending | refunded

-- ── 2. Value constraints (guarded so re-runs don't error) ───────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'osg_seller_decision_chk') then
    alter table public.order_seller_groups
      add constraint osg_seller_decision_chk
      check (seller_decision in ('pending','accepted','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'osg_refund_status_chk') then
    alter table public.order_seller_groups
      add constraint osg_refund_status_chk
      check (refund_status is null or refund_status in ('pending','refunded'));
  end if;
end $$;

comment on column public.order_seller_groups.seller_decision is
  'Per-seller acceptance of their own slice: pending | accepted | rejected. Orthogonal to fulfillment_status. Set by seller_accept_group / seller_reject_group (Step 2b).';
comment on column public.order_seller_groups.refund_owed_yer is
  'Manual-refund flag: amount owed back to the customer when this seller rejected (rejected subtotal + delivery-fee difference). System computes & flags; the admin refunds by hand.';

-- ── 3. Backfill from the current order status (single group per order today) ─
-- Only touches rows still at the freshly-added default so re-runs never clobber a
-- real later decision.
update public.order_seller_groups g
   set seller_decision = case
         when o.status = 'rejected'                     then 'rejected'
         when public.order_status_rank(o.status) >= 1   then 'accepted'
         else                                                'pending'
       end
  from public.orders o
 where o.id = g.order_id
   and g.seller_decision = 'pending';
