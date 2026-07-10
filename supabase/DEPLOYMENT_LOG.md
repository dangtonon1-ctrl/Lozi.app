# Supabase Deployment Log

A running record of migrations applied directly to the **live** project
(`niloddwnllhsvrmuxfxw`, "Lozi") outside the normal CI path, with the
before/after evidence captured at apply time. Newest first.

---

## 2026-07-10 — `20260719_seller_group_decision_schema` + `20260720_seller_group_accept_reject`

Unified-cart **Step 2** — per-seller order accept/reject (server-side only,
backward-compatible). Applied 2a then 2b, in that order.

### What it changes

- **2a (additive schema):** adds `seller_decision` (pending|accepted|rejected),
  `decided_at`, `decline_reason`, and a manual-refund flag
  (`refund_rejected_subtotal`, `refund_fee_diff`, `refund_owed_yer`,
  `refund_status`) to `order_seller_groups`. Backfilled from `orders.status`
  rank. Nothing reads the columns yet.
- **2b (logic):** `recompute_order_status_from_groups()`,
  `seller_accept_group()`, `seller_reject_group()` (SECURITY DEFINER,
  `authenticated`-only, ownership-checked); a manual-refund flag (never
  auto-refunds); `notify_order_event()` gains a `seller_rejected` case; and
  `orders_customer_facing` now excludes seller-rejected groups from its stage
  aggregate. An order **continues** with the remaining sellers on a partial
  reject and is only cancelled (`status='rejected'`) when **every** seller
  rejects. Reject is allowed only while the group is still `paid_by_customer`
  (before the goods head to the hub).

**Client untouched.** The RPCs are not yet called by the app (the existing
`orders_seller_update` direct-write path stays); the client cutover is Step 2c.

### Verification (pre-verified on an isolated local replica seeded from the live 17 orders; prod never written during testing)

- **2a on live:** backfill audit **17/17 match, 0 mismatches** (9 accepted / 7
  pending / 1 rejected); 17-order diff of `orders.status` +
  `customer_facing_status` + seller `internal_status` vs pre-apply snapshot →
  **0 rows changed**.
- **2b on live:** same 17-order diff → **0 rows changed** (RPCs unused by the
  client). New objects confirmed present: `seller_accept_group`,
  `seller_reject_group`, `recompute_order_status_from_groups`, and the updated
  `orders_customer_facing` view (security_invoker, carries the `seller_decision`
  exclusion).
- **Security advisor:** 52 → 54 lints; the only new entries are two
  `authenticated_security_definer_function_executable` for `seller_accept_group`
  / `seller_reject_group` (identical to the existing `seller_mark_to_hub`,
  `customer_cancel_order`, … pattern). **No new** `function_search_path_mutable`
  and **no new** `security_definer_view`.

---

## 2026-07-09 — `20260711_commission_progressive_brackets`

Applied the dormant progressive-bracket commission migration to live. The file
was merged to `main` (PR #50) but had never been applied to the live database.

### What it changes

Replaces the flat single-tier commission math in `charge_commission` and
`osg_on_inspect` with **progressive/marginal brackets**: each slice of an
order's goods is charged at its own tier's rate (weighted), instead of one flat
rate pinned to the seller's pre-order tier.

- **New:** `commission_bracket(text, numeric, numeric)` — marginal-bracket
  calculator, the single source of truth for the amount.
- **New:** `get_commission_amount(uuid, text, numeric, numeric)` — bracket
  amount for a would-be order (hub-inspection preview).
- **Replaced:** `charge_commission(uuid)` and `osg_on_inspect()` now call the
  bracket calculator.
- Create-or-replace only — **no** new tables/columns; reuses `commission_tiers`
  and the existing `profiles` counters. Tier rates/thresholds untouched.

**Not retroactive.** Both engines guard `if commission_state is not null then
return`, so already-charged/reversed orders stay frozen. Historical rows keep
their exact prior snapshot.

### Before snapshot (live, immediately pre-apply)

14 orders total — 10 settled (charged/reversed), 4 with `commission_state`
NULL (3 in-flight new/preparing + 1 rejected).

| order_no | status | segment | commission_state | commission_amount | rate | goods_subtotal | cumulative_before |
|---|---|---|---|---:|---:|---:|---:|
| 018578 | delivered | retail | charged | 430.00 | 0.0200 | 21500.00 | 0.00 |
| 242145 | delivered | wholesale | charged | 259.00 | 0.0070 | 37000.00 | 0.00 |
| 401867 | rejected | – | NULL | NULL | – | NULL | NULL |
| 879561 | delivered | retail | charged | 340.00 | 0.0200 | 17000.00 | 0.00 |
| 639613 | delivered | retail | charged | 31.50 | 0.0175 | 1800.00 | 21500.00 |
| 761407 | payreview | retail | reversed | 31.50 | 0.0175 | 1800.00 | 23300.00 |
| 087932 | delivered | retail | charged | 599.98 | 0.0200 | 29999.00 | 0.00 |
| 632952 | delivered | retail | charged | 112.20 | 0.0200 | 5610.00 | 5994.00 |
| 758868 | delivered | retail | charged | 119.88 | 0.0200 | 5994.00 | 0.00 |
| 924379 | delivered | retail | charged | 3.47 | 0.0175 | 198.00 | 11604.00 |
| 110336 | payreview | retail | reversed | 1662.50 | 0.0175 | 95000.00 | 11802.00 |
| 018208 | preparing | – | NULL | NULL | – | NULL | NULL |
| 266621 | new | – | NULL | NULL | – | NULL | NULL |
| 837936 | new | – | NULL | NULL | – | NULL | NULL |

Frozen-state fingerprints (md5 over the commission columns / OSG snapshot):

- orders: `5941f0468b5a8dbd97fc4bc80a2af648`
- order_seller_groups: `1455c99e12478e534085cfc9a766863f`

### Verification (post-apply)

1. **Functions present & switched.** `commission_bracket` and
   `get_commission_amount` now exist; `osg_on_inspect` and `charge_commission`
   both call the bracket calculator (no more flat-rate helper).
2. **Frozen rows unchanged — zero drift.** Re-computed fingerprints match the
   before-snapshot exactly:
   - orders `5941f0468b5a8dbd97fc4bc80a2af648` → **identical**
   - order_seller_groups `1455c99e12478e534085cfc9a766863f` → **identical**
3. **Numeric correctness** (read-only `STABLE` calls, no data touched), retail,
   `cumulative_before = 0`:
   - 1,000,000 goods → **11,650.00** (flat would have been 20,000)
   - 20,000,000 goods → **116,650.00**
   - `get_commission_amount` wrapper returns the same values.
4. **Security advisor.** No new findings vs. the pre-apply baseline (identical
   lint counts; none of the four functions flagged). Hardening baked into the
   migration and confirmed live: `search_path = public` on all four; the three
   `SECURITY DEFINER` functions (`charge_commission`, `get_commission_amount`,
   `osg_on_inspect`) revoked from `public, anon, authenticated` →
   `{postgres, service_role}`; `commission_bracket` left as the anon/
   authenticated-readable invoker helper (mirrors `get_tier`). This matches how
   the delivery-fee functions were hardened.
5. **Delivery-fee path & `order_seller_groups` unaffected.**
   `trg_orders_enforce_delivery_fee` → `lozi_orders_enforce_delivery_fee` still
   enabled and unchanged; `order_seller_groups` snapshot fingerprint unchanged.

Ledger version recorded as `20260711` to match the merged repo filename
(`supabase/migrations/20260711_commission_progressive_brackets.sql`).
