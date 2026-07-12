# Supabase Deployment Log

A running record of migrations applied directly to the **live** project
(`niloddwnllhsvrmuxfxw`, "Lozi") outside the normal CI path, with the
before/after evidence captured at apply time. Newest first.

---

## 2026-07-11 — `20260727_orders_price_integrity` — ✅ APPLIED

Server-side **price integrity** for orders. Item prices in `orders.items` (jsonb)
were client-supplied; the DB validated only the delivery fee (`20260717`) and took
`items[].price` at face value. A tampered price corrupted the customer charge
(`orders.total`), the per-seller commission base
(`order_seller_groups.subtotal_amount`), each seller's commission, and their
cumulative-sales counter — all in one INSERT. Demonstrated live (rolled-back txn):
a two-item order tampered to `price:500` each produced `total 2250` and commission
bases `500/500` instead of the honest `48250` and `37000/10000`.

### What it changes

Folds price normalization into the existing `BEFORE INSERT/UPDATE` trigger function
`lozi_orders_enforce_delivery_fee` (no new trigger → no firing-order fragility):

- **Non-admin INSERT:** (1) **reject** if any catalog (uuid) line item's product is
  missing, `status <> 'available'`, or has a NULL price (`errcode 23514`); (2)
  overwrite each catalog item's `price` with the authoritative `products.price`
  (RFQ non-uuid `p` items exempt); (3) recompute `delivery_fee`/`total` from the
  corrected items (unchanged logic, corrected inputs).
- **Non-admin UPDATE:** pin `items`, `total` **and** `delivery_fee` to their stored
  `OLD` values — closes the seller-UPDATE tamper vector.
- **Admin (`is_admin()`):** full bypass preserved (wholesale/RFQ quoting, manual
  corrections).

Single `CREATE OR REPLACE` on one function. Pre-image at
`supabase/rollback/20260727_orders_price_integrity_preimage.sql`. No data modified
(INSERT-time logic only; settled orders frozen).

### Replica verification (local Postgres, seeded read-only from prod)

Faithful replica (7 chain tables verbatim DDL, all 67 `public` functions, 5 order
triggers, RLS policies + grants, real prod product/profile/tier rows). Baseline
first reproduced today's behavior byte-for-byte, then the migration was applied and
the suite run — all green:

- tampered `500/500` → corrected to live: `total 48250`, bases `37000/10000`,
  commissions `672.50/200`; driven to `delivered`, seller counters advanced
  `0→37000` / `0→10000` and OSG charged `672.50/200` (payout snapshot correct);
- honest insert → byte-identical to baseline (`48250`, `37000/10000`);
- missing product & hidden product → both **rejected** with the clear error;
- RFQ item → price `666` **untouched**, sibling catalog item corrected;
- seller UPDATE of items/total → **pinned** to OLD (tamper ignored);
- suspended-seller RLS block + delivery-fee recompute + group sync all still fire;
- admin insert → custom price/total **preserved**.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260711225045`).

- **Function switched.** `md5(pg_get_functiondef(lozi_orders_enforce_delivery_fee))`
  went `708d33fe73fbb556a78abbdfdcefecda` (pre-image) → `6d04b08eee94abe48b85e5e7ca6b0309`.
- **Live attack demo (rolled-back txn).** Two-item order, tampered `price:500` each
  vs honest `37000/10000`, both inserted as the same customer:

  | order | total | delivery_fee | stored prices | group bases |
  |-------|------:|-------------:|---------------|-------------|
  | honest   | 48250 | 1250 | `[37000, 10000]` | `37000 / 10000` |
  | tampered | 48250 | 1250 | `[37000, 10000]` | `37000 / 10000` |

  The tampered order is corrected to the honest outcome — customer charge, delivery
  fee, and per-seller commission bases all derived from `products.price`.
- **No data touched.** `orders` row count unchanged (22 before and after); demo rows
  rolled back (residue 0).
- **Rollback validated.** Re-running
  `supabase/rollback/20260727_orders_price_integrity_preimage.sql` reproduces the
  pre-image exactly (`md5 708d33fe73fbb556a78abbdfdcefecda`).

### DEFERRED (explicit follow-ups — NOT in this change)

- **byAmount purchase path.** The dormant "buy N riyals worth" flow flattens to
  `{q:1, price:round(amount)}`, indistinguishable from a normal item, so this
  migration treats every uuid item as unit-priced (which would corrupt a byAmount
  line). Mitigation shipped alongside: the byAmount purchase UI is **disabled
  client-side** (`src/scripts/app.shop.js`, `buy-mode` block gated behind `false`)
  so no user can create one. **TODO:** re-enable only with a coordinated fix that
  stores byAmount as `{q: amount/live_price, price: live_price, amount}` and has
  the trigger recompute `q := amount/price`.
  **UPDATE (2026-07-12):** server side written & replica-verified as
  `20260728_orders_byamount_reinstate` (intent-only `{p, mode:'amount', amount}`;
  trigger derives `grams := floor(amount/price*1000)`, `q := grams/1000`; quarter
  categories only; rejects non-positive/sub-gram/non-quarter). **Not yet applied
  to prod; client still gated** — client cutover + guard removal is the next phase.
- **RFQ price cross-check.** Non-uuid `rfq-*` items pass through untouched today.
  **TODO (phase 2):** validate their price against `rfq_offer_items` for the
  accepted offer (`offer_item_id` is embedded in the `rfq-<uuid>` id).
- **Unify product price semantics (byAmount beyond quarter cats).** byAmount is
  scoped to almond/raisin/savings because only there is `products.price`
  guaranteed per-kilogram (weight basis 1 kg). The schema already carries unused
  `price_per_kg` + `min_order_grams` columns; populate/use them (seller form +
  `20260728`-style trigger derivation) so byAmount can safely extend to packaged
  retail/vip products. The live retail product with `data.weight='500'`
  (per-kg ≠ `price`) is the known offender that this would fix. **Not implemented.**

---

## 2026-07-11 — `20260726_orders_realtime_publication`

Realtime Phase 1 (orders) — **Step (i): server enablement only**. Adds the two
order tables to the `supabase_realtime` publication so Postgres emits change
events for them, and strips `anon`'s latent DML grants on `order_seller_groups`
(defense-in-depth, mirroring the `20260725` orders hardening). **Client
untouched** — no live behavior changes until the per-role client increments
(ii)–(iv) ship. Rollback pre-image at
`supabase/rollback/20260726_orders_realtime_publication.sql`.

### What it changes

- **(1)** `alter publication supabase_realtime add table public.orders` and
  `... add table public.order_seller_groups` (each guarded by a
  `pg_publication_tables` existence check → idempotent). This is the **entire**
  server requirement for live order tracking: no schema change, **no
  `REPLICA IDENTITY` change** (client subscribes to INSERT+UPDATE only and
  re-fetches on event, so the default PK replica identity authorizes each
  subscriber against the NEW record via the existing RLS SELECT policies), no
  new RLS policies, no new grants. DELETE is deliberately out of scope (Realtime
  does not apply RLS to DELETE).
- **(2)** `revoke select, insert, update, delete on public.order_seller_groups
  from anon` → removes latent attack surface. RLS already denied `anon` (no anon
  policy on the table) and `anon` never subscribes to these tables, so no
  legitimate path changes. Brings the table in line with `orders` (whose anon
  SELECT/INSERT were revoked in `20260725`).

Realtime evaluates RLS against the **base** table, which requires `authenticated`
to hold a direct `SELECT` grant — confirmed still present on both tables after
the change (see evidence).

### Before → after evidence

`supabase_realtime` publication membership (public schema):

- **Before:** `chat_flag_alerts, conversations, messages, notifications, rfq_flag_alerts`
- **After:**  `chat_flag_alerts, conversations, messages, notifications, order_seller_groups, orders, rfq_flag_alerts`

`anon` grants on `public.order_seller_groups`:

- **Before:** `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`
- **After:**  `REFERENCES, TRIGGER, TRUNCATE` (all API-reachable DML removed)

`authenticated` SELECT on base tables (Realtime authorization requirement) —
**unchanged / still present:** `public.orders` = `SELECT`,
`public.order_seller_groups` = `SELECT`.

---

## 2026-07-10 — `20260725_close_demo_insert_anon_hole`

Security hardening — closes the `demo_insert` anon-INSERT hole on `public.orders`
(the follow-up flagged in the Step-3 entry below). **Client untouched.**

### What it changes

`demo_insert` was a leftover always-true permissive INSERT policy (`WITH CHECK
true`, no role → PUBLIC incl. `anon`) — the INSERT-side twin of the `demo_read`
policy dropped in `20260706_orders_read_isolation`. Checkout is always
authenticated (the client sets `customer_id = auth.uid()` and refuses checkout
without a session — no anon insert path exists anywhere in the client), so the
policy was pure attack surface. Applied as one migration, statements in strict
dependency order (each independently reversible; rollback pre-image at
`supabase/rollback/20260725_close_demo_insert_anon_hole.sql`):

- **(a)** `drop policy demo_insert` → `anon` now has no satisfiable permissive
  INSERT policy (`orders_insert` is `to authenticated`; the admin policies need
  `is_admin()`), so RLS denies anon INSERT.
- **(b)** `revoke insert on orders from anon` → defense-in-depth (RLS already denies).
- **( )** `revoke select on orders from anon` → latent Supabase-default grant; no
  SELECT policy ever applied to `anon`, so this changes no legitimate read.
- **(c)** `revoke execute … from anon` on the two `SECURITY DEFINER` helpers,
  matching `is_suspended`'s ACL: `is_seller_on_order` (only used by the
  `to authenticated` read policy) and `order_has_suspended_seller` (only used by the
  restrictive INSERT block — anon can no longer insert, so never needs it; hence
  ordered **after** (a)). The Step-3 `revoke … from public` had not stripped the
  **direct** `anon` grant that Supabase's schema default-privilege adds, so this
  revokes from `anon` explicitly.

The legitimate customer path is untouched and intact: `orders_insert`
(`to authenticated`, `WITH CHECK auth.uid() = customer_id`) AND-ed with the
restrictive `orders_block_suspended_seller`. Authenticated still holds its INSERT
grant and EXECUTE on both helpers.

### Verification (local Postgres replica — schema pulled verbatim from prod; run as BOTH `anon` and `authenticated`; prod never written during testing)

- **Baseline (hole):** `set role anon` → INSERT **succeeds** (`INSERT 0 1`).
- **After change:** `set role anon` → INSERT and SELECT both **rejected**
  (`permission denied for table orders`).
- **Authenticated customer happy path:** `INSERT 0 1`; all four INSERT triggers
  fired — delivery-fee BEFORE trigger corrected a wrong 99 → **1000** (total
  **11000**), `orders_make_groups` created **1** group (subtotal 10000),
  `decrement_stock` 100 → **98**; then status → `delivered` drove the commission
  engine to **200.00 charged @0.0200**, seller cumulative → **10000**. All assertions pass.
- **Suspension block:** suspended seller → **rejected** (`orders_block_suspended_seller`);
  active → succeeds. **Ownership:** authenticated A inserting `customer_id = B` →
  **rejected**. **Reversibility:** rollback re-opens (anon INSERT succeeds), forward
  re-closes (anon INSERT rejected).

### Security advisor

**58 → 55 lints, 0 added.** Removed exactly **3**:
`anon_security_definer_function_executable` for `is_seller_on_order` **and**
`order_has_suspended_seller` (now match `is_suspended` — no `anon`), plus
`rls_policy_always_true` on `orders` (that was `demo_insert`'s `WITH CHECK true`).
No other lint changed.

---

## 2026-07-10 — `20260724_commission_per_seller_1_schema` + `20260724_commission_per_seller_2_engine` + `20260724_commission_per_seller_3_orchestrator`

Unified-cart **Step 4** — per-seller commission engine (server-only, Option B:
keeps the existing order-level `status='delivered'` trigger point; per-seller
independent timing deferred as Step 4d). Applied 4a → 4b → 4c behind money gates.
**Client untouched. Step 4d not built.**

### What it changes

- **4a (additive schema):** authoritative per-group commission columns on
  `order_seller_groups` (`commission_segment`, `commission_rate_applied`,
  `commission_amount`, `cumulative_before`, `commission_state`, `reversed_amount`)
  + two guarded CHECK constraints. **No backfill** — nothing reads them yet.
- **4b (engine):** `resolve_group_segment(order,seller)`,
  `charge_group_commission(group)`, `reverse_group_commission(group,ret)` — mirrors
  of the order-level engine keyed to a group. Same `commission_bracket` progressive
  math, same rounding, same zero-floor; each seller advances/decrements only their
  own retail/wholesale counter on their own `subtotal_amount`. The two money movers
  are `SECURITY DEFINER`, `search_path=public`, revoked from `public/anon/authenticated`
  → `{postgres, service_role}` (identical to `charge_commission`);
  `resolve_group_segment` is a read-only invoker helper (mirrors
  `resolve_order_segment`).
- **4c (orchestrator cutover):** `charge_commission` now loops the eligible
  (non-`rejected`, non-`rejected_at_hub`) groups via `charge_group_commission`, then
  rolls the sum onto `orders.commission_amount` (display) — for a single-seller order
  this is byte-identical to the old engine. `reverse_commission` uses the per-group
  engine when the order was charged per-group, else falls back to the **verbatim**
  pre-Step-4 order-level body so legacy-charged orders reverse byte-identically. The
  order-level guard AND the per-group guard together make a group chargeable at most
  once. Rollback pre-image committed at `supabase/rollback/20260724_commission_per_seller_preimage.sql`.

**Not retroactive.** Both guards (`orders.commission_state`, per-group
`commission_state`) freeze already-settled rows; historical rows keep their exact
snapshot. The 8 legacy order-level charges carry no per-group rows and reverse via
the verbatim fallback.

### Pre-apply before-image (live, immediately pre-apply)

17 orders — 10 settled (`commission_state` not null), 17 groups; 5 sellers with
counters; `charge_commission` still the OLD order-level engine.

Frozen-state fingerprints (md5 over the commission columns):

- orders (10 settled): `383558e64c21ab6b3d5017c73a7bab23`
- order_seller_groups (17, snapshot cols): `02211b1425e5464b1074505d2a56e26a`

### Verification (gated apply on live; also pre-verified on a local Postgres replica seeded read-only from the live 17 orders, run incl. as the non-superuser `authenticated` role — Supabase branching is Pro-gated)

1. **4a:** 6 columns added, 2 constraints, **0 rows backfilled**; both fingerprints
   **unchanged**.
2. **4b:** three functions present; `charge_group_commission` /
   `reverse_group_commission` = `SECURITY DEFINER`, `search_path=public`, ACL
   `{postgres, service_role}`; `has_function_privilege('authenticated', …)` = **false**
   for both (and `anon` false); `resolve_group_segment` = invoker, `search_path=public`.
   Fingerprints still **unchanged** (nothing wired).
3. **4c money gate — BYTE-IDENTICAL:** re-captured fingerprints post-cutover →
   orders `383558e64c21ab6b3d5017c73a7bab23` **identical**, order_seller_groups
   `02211b1425e5464b1074505d2a56e26a` **identical**.
   - **Single counter-advancing path:** `charge_commission` no longer references
     `cumulative_sales` (delegates); exactly **one** `+`-path live
     (`charge_group_commission`).
   - **Idempotency (rolled-back txn):** re-invoking `charge_commission` on settled
     order `4b64aa15` left the order row, seller profile, and group rows all
     unchanged; the transaction was rolled back (nothing written).
   - Replica proofs: single-seller OLD-vs-NEW replay identical on
     `commission_amount` / `commission_rate_applied` / `cumulative_before` / counter
     delta (rejected order charges nothing, as intended); multi-seller synthetic
     (own-subtotal/own-track advance, Σ = order amount, seller- & hub-rejected never
     charged, single-seller reversal isolates that seller zero-floored, charge
     idempotent); bracket edges via the per-group path retail 1,000,000→11,650.00 &
     20,000,000→116,650.00; legacy full-reversal OLD-vs-NEW byte-for-byte identical.

### Security advisor

58 → **58** lints — **no change**. No new
`authenticated_security_definer_function_executable` (the new money movers are
revoked from `authenticated`/`anon`, matching `charge_commission`, so they are not
flagged), and **no new** `function_search_path_mutable` (2 → 2) or
`security_definer_view` (2 → 2). The three Step-4 functions are not flagged.

Ledger versions recorded as `20260724` to match the merged repo filenames
(`supabase/migrations/20260724_commission_per_seller_{1_schema,2_engine,3_orchestrator}.sql`).

---

## 2026-07-10 — `20260721_seller_read_group_based` + `20260722_seller_mark_to_hub_group_based` + `20260723_block_suspended_any_seller`

Unified-cart **Step 3** — group-based seller RLS/RPCs (server-only, backward-compatible).
Applied 3a → 3b → 3c in order, each behind a gate. Client unchanged.

### What it changes

- **3a `orders_seller_read`** → group-based: a seller may read an order iff they own
  one of its `order_seller_groups`. Evaluated via a SECURITY DEFINER helper
  `is_seller_on_order(uuid)` so the group read bypasses RLS (avoids infinite
  recursion with `osg_customer_read`, which reads back `orders`).
- **3b `seller_mark_to_hub`** → order lookup by group membership; the
  `status='preparing'` guard and the inner (own-group, forward-only) update are
  unchanged.
- **3c `orders_block_suspended_seller`** → blocks checkout if ANY resolved seller in
  the order's items is suspended, via `order_has_suspended_seller(jsonb,uuid)`. Kept
  **AS RESTRICTIVE** (verified `pg_policy.polpermissive = false`) so it actually
  blocks (AND-ed with the permissive insert policies).
- `orders_seller_update` left untouched (deferred to the 2c client cutover).

### Verification (local replica seeded read-only from the live 17 orders, run as the non-superuser `authenticated` role; then re-verified on live)

- **Pre-apply snapshot (live):** 17 orders, old access booleans — read(realseller)=true,
  read(nonseller)=false, block=false, mark(realseller)=true.
- **3a (live):** read/mark equivalence old-vs-new **85/85, 0 mismatches**; a live
  seller read returned rows with **no RLS-recursion error**.
- **3b (live):** real seller of a preparing order → lookup resolves; new order →
  `status='preparing'` guard fires; non-seller → `order not found`.
- **3c (live):** policy is **RESTRICTIVE**; block equivalence **17/17, 0 mismatches**;
  in a rolled-back txn a suspended-seller insert was **blocked** and an all-active
  insert **succeeded** (nothing written).

### Security advisor

54 → 58 lints. Expected **+2** `authenticated_security_definer_function_executable`
(`is_seller_on_order`, `order_has_suspended_seller`). Also **+2**
`anon_security_definer_function_executable` for the same two functions: Supabase's
schema default privileges grant EXECUTE to `anon`, and `revoke … from public` does
not remove that explicit `anon` grant (`is_suspended`, by contrast, has no `anon`
grant). No new `function_search_path_mutable` and no new `security_definer_view`.

**Follow-up (not yet done — pending review):** revoke EXECUTE from `anon` on
`is_seller_on_order` (safe — only used by the `to authenticated` read policy) to
match `is_suspended`. `order_has_suspended_seller` is evaluated by the INSERT block
policy, which applies to `anon` (because the leftover always-true `demo_insert`
policy + `anon` INSERT grant let anon insert); revoking it from `anon` would break
anon inserts, so the clean fix is to remove `demo_insert` first. Both are out of
Step-3 scope.

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
