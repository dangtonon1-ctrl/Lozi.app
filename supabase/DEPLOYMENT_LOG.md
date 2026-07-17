# Supabase Deployment Log

A running record of migrations applied directly to the **live** project
(`niloddwnllhsvrmuxfxw`, "Lozi") outside the normal CI path, with the
before/after evidence captured at apply time. Newest first.

---

## 2026-07-17 — `20260739_byamount_retail_expansion` — ✅ APPLIED (M4 — retail-by-kg fee overhaul, step 4 of 4)

Expands byAmount (buy-by-money-amount) from the quarter categories
(almond/raisin/savings) to ALL consumer sold-by-kg products, adds a per-product
opt-out, and syncs the client in lockstep.

### Server (`20260739`)

- New column `products.allow_byamount boolean NOT NULL DEFAULT true`.
- byAmount D1 gate in `lozi_orders_enforce_delivery_fee()` changed from
  `category in (almond,raisin,savings)` to:
  ```
  is_consumer (category <> 'wholesale')
    AND weight_grams = 1000        -- sold-by-kg 1 kg basis (M2); excludes fixed packs & NULL
    AND NOT (data->>'bundle')      -- excludes fixed assorted bundles
    AND allow_byamount             -- per-product opt-out
  ```
  Wholesale + RFQ (non-uuid) hard-rejected structurally; D2 (amount>0, price>0,
  buys ≥1 gram) unchanged. byAmount grams derivation `floor(amount/price*1000)`
  unchanged — stays in lockstep with the client.

### Client (lockstep, deploys on merge)

- `rowToProduct` (app.main.js) exposes `weight_grams` + `allow_byamount`.
- Product page (app.shop.js) reads `p.weight_grams` instead of `weightKg()` (the
  free-text parser is now unused).
- Customer byAmount gate mirrors the server predicate.
- Weight-fee DISPLAY stays store-fee-only (accepted RN Phase 2 gap); seller-form
  toggle + kg-enforcement UI deferred to RN Phase 2.

### Pre-M4 confirmation (as required)

Continuous-weight vs fixed-pack is represented today **only** by `data.bundle=true`
(assorted offer; `data.unit` unused). After M2, `weight_grams=1000` is the numeric
sold-by-kg signal. The gate excludes fixed packs (`bundle` OR `weight_grams<>1000`)
and all wholesale (structural). ✅

### Evidence (live, post-apply)

`allow_byamount` present, default `true`, 0 non-true rows. Gate verified as M4 (new
predicates present, old almond/raisin/savings scope gone). **18 visible retail
products byAmount-eligible**; 5 wholesale, 1 bundle, 2 non-kg retail excluded.
`md5(pg_get_functiondef(...)) = 3ce8be051962d69f8e8779613bbb8359`.

### Rollback

`supabase/rollback/20260739_byamount_retail_expansion_preimage.sql` restores the
`20260738` function (quarter-category gate) and drops `allow_byamount`. Roll back
the client (rowToProduct / weightKg / gate) in lockstep.

---

## 2026-07-17 — `20260738_delivery_weight_fee` — ✅ APPLIED (M3 — retail-by-kg fee overhaul, step 3 of 4)

Extends `public.lozi_orders_enforce_delivery_fee()` (from `20260735`) with a
per-kg weight fee on top of the M1 store fee, reading grams numerically from
`products.weight_grams` (M2) — no more text parsing. Adds a display-only
`orders.vehicle_type` column.

### Formula (retail path)

```
store_fee    = lozi_delivery_fee(distinct_sellers)      -- M1
free_kg      = 20 + 10*(distinct_sellers - 1)
billable_kg  = floor( sum(grams per line) / 1000 )      -- fractional kg dropped
weight_fee   = max(0, billable_kg - free_kg) * 30       -- UNCAPPED
delivery_fee = store_fee + weight_fee
vehicle_type = motorcycle if raw grams <= 50000 else truck
```

Per-line grams: catalog (uuid) line = `q * coalesce(products.weight_grams, 1000)`;
RFQ/non-uuid line = 0. A byAmount line is a uuid line with `weight_grams=1000` and
`q = floor(amount/price*1000)/1000`, so `q*1000` == its floor-derived grams.

### Decisions (Qaari-approved)

- Free-delivery promo waives the **store fee only**; weight_fee still charged.
- NULL `weight_grams` (pre-RN-Phase-2 new product) → **1000 g** fallback.
- `vehicle_type` in a **new `orders.vehicle_type` column** (`CHECK in
  ('motorcycle','truck')`), set authoritatively, pinned to OLD on non-admin
  UPDATE, NULL for wholesale.
- RFQ/non-uuid lines → **0 grams** (preserves their store-fee-only treatment).

Client NOT synced — `weight_fee` is server-only; the web `feeFor()` shows the
store fee only (accepted RN Phase 2 gap).

### Evidence (read-only, live M1 helper + M3 math)

| sellers | kg | store | free_kg | billable | weight_fee | delivery | vehicle |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 1000 | 20 | 3 | 0 | 1000 | motorcycle |
| 1 | 25 | 1000 | 20 | 25 | 150 | 1150 | motorcycle |
| 1 | 50 | 1000 | 20 | 50 | 900 | 1900 | motorcycle |
| 1 | 60 | 1000 | 20 | 60 | 1200 | 2200 | truck |
| 2 | 55 | 1300 | 30 | 55 | 750 | 2050 | truck |
| 3 | 100 | 1600 | 40 | 100 | 1800 | 3400 | truck |

Boundaries: 20th kg free (charge starts at 21), `≤50 kg` = motorcycle. Post-apply
verified: `orders.vehicle_type` present, `CHECK ((vehicle_type IS NULL) OR
(vehicle_type = ANY (ARRAY['motorcycle','truck'])))`, `md5(pg_get_functiondef(...))
= 3998c0b96e59eebc4a2b4f4cd1997fd1`.

### Rollback

`supabase/rollback/20260738_delivery_weight_fee_preimage.sql` restores the verbatim
`20260735` function (store-fee only) and drops `orders.vehicle_type` (roll back M4
first if applied).

---

## 2026-07-17 — `20260737_products_weight_grams` — ✅ APPLIED (M2 — retail-by-kg fee overhaul, step 2 of 4)

Adds `products.weight_grams integer` as the numeric source of truth for retail
weight, replacing the free-text `data.weight` parsed by `weightKg()`
(`app.shop.js`). Nullable, `CHECK (weight_grams IS NULL OR weight_grams > 0)`.
Read by the M3 weight-fee layer and M4 byAmount derivation. `data.weight` is left
untouched as the display/audit string.

### Backfill (Qaari-approved)

- **Clean sold-by-kg retail → 1000:** the 18 rows whose `data.weight.ar` matches
  `^\s*1\s*(كيلو|كجم|كغ|kg)?\s*$` (i.e. `"1"` / `"1 كيلو"`).
- **Two live mis-parses kept visible → 1000:** `e9b734f3` لوززز ذماري (was `"500"`
  ⇒ the 500 kg bug), `1594de4a` تجربة تجزئة (bundle `"عرض مشكّل"`).
- **Four junk test rows hidden** (weight_grams left NULL): `e17b23b7` `"و"`,
  `378c34e3` `"ف"`, `72fabeb0` `"حبة البركة"`, `72757f62` `"غ"`.
- **Wholesale left NULL** (admin-quoted delivery, no weight_fee; M4 hard-rejects
  wholesale byAmount — no consumer in M1–M4).

`price`=per-kg invariant: every backfilled row is a 1 kg basis, so the stored
`price` already equals price-per-kg — **no price data changed**. Input-time kg
enforcement is the seller form, deferred to RN Phase 2.

### Evidence (live, post-apply)

| category | wg=1000 | wg=NULL | total |
|---|---|---|---|
| retail | 20 | 2 (hidden junk) | 22 |
| wholesale | 0 | 5 | 5 |

The 6 formerly-mis-parsing rows verified: #1/#2 → 1000 & visible; #3–#6 → NULL &
hidden. Pre-apply read-only check: clean regex matched exactly 18 rows, 0 of the 6.

### Rollback

`supabase/rollback/20260737_products_weight_grams_preimage.sql` un-hides the four
rows and drops the constraint + column (roll back M3/M4 first if applied).

---

## 2026-07-17 — `20260736_delivery_store_fee_params` — ✅ APPLIED (M1 — retail-by-kg fee overhaul, step 1 of 4)

Bumps the two tunable constants of the authoritative store-fee helper
`public.lozi_delivery_fee(int)` (first defined in `20260717_delivery_fee_server_validation`):
surcharge per extra distinct seller **250 → 300**, hard cap **2000 → 2500**. Base
(1000) and the `store_count < 1 → 0` guard are unchanged. This helper is the
**store-fee component only**; the `weight_fee` layer lands in M3, where the orders
trigger will compute `delivery_fee = lozi_delivery_fee(count) + weight_fee`.

### Change (single `CREATE OR REPLACE`, one function)

```
before:  least(1000 + 250 * (greatest(store_count, 1) - 1), 2000)
after:   least(1000 + 300 * (greatest(store_count, 1) - 1), 2500)
```

### Evidence (live, post-apply via `select lozi_delivery_fee(n)`)

| distinct sellers | 1 | 2 | 3 | 5 | 6 | 9 |
|---|---|---|---|---|---|---|
| fee (YER) | 1000 | 1300 | 1600 | 2200 | 2500 | 2500 |

n=1 unchanged (1000); old capped at 2000 (n≥5), new caps at 2500 (n≥6).

### Client sync (shipped in lockstep — Qaari-approved)

`app.shop.js` `feeFor()` bumped `Math.min(FEE+250*(n-1),2000)` →
`Math.min(FEE+300*(n-1),2500)` so displayed fee == charged fee for multi-seller
carts (single-seller was already identical). **Accepted gap:** M3's `weight_fee`
is NOT client-synced — after M3 the web client shows store-fee only (no weight
component); full fee display is deferred to RN Phase 2.

### Rollback

`supabase/rollback/20260736_delivery_store_fee_params_preimage.sql` restores the
verbatim live 250/2000 body. Roll the client `feeFor()` constant back together
with it. Blast radius: orders `BEFORE INSERT/UPDATE` trigger + seller-group
accept/reject recompute (`20260720`) pick up the new fee immediately; existing
orders keep their pinned `delivery_fee`; no data modified.

---

## 2026-07-13 — `20260735_orders_rfq_price_crosscheck` — ✅ APPLIED (server, price-integrity Phase 2 — RFQ)

Closes the **"RFQ price cross-check"** item DEFERRED under `20260727`. The price-
integrity shield (`20260727`/`20260728`) validates and rewrites only **catalog
(uuid)** line items — every rule is gated on `(p ~ '^[0-9a-fA-F-]{36}$')`. An RFQ
line carries a **non-uuid** id, `rfq-<offer_item_id>` (client `app.main.js
acceptRfqOffer` → `addToCart({id:"rfq-"+it.offer_item_id, price:oi.price …})` →
the **normal checkout INSERT**), so it SKIPPED the missing-product reject AND the
price overwrite. Its price and quantity were taken at **face value** and flowed
straight into `orders.total`, `order_seller_groups.subtotal_amount`, the
per-seller commission base and the seller's cumulative-sales counter. Because
"RFQ" is nothing but the item **shape**, ANY authenticated customer could forge a
normal checkout INSERT with `items:[{p:"rfq-<anything>", q, price}]` and ride the
exemption — the same tamper the catalog shield blocks, through the one door it
left open.

### What it changes (single `CREATE OR REPLACE`, one function — non-admin INSERT branch)

- **(1) Structural reject.** Every **non-catalog** line must be a valid,
  buyer-accepted RFQ line: `p` matches `rfq-<uuid>`; the `rfq_offer_items` row
  exists; its `rfq_offers` row is `status='accepted'`; that offer's request
  `buyer_id` equals the order's `customer_id`; that offer's `seller_id` equals the
  order's `seller_vendor_id`; and `q` is positive and `<= available_quantity`.
  Anything else — a bogus/foreign/unaccepted offer id, wrong buyer or seller, an
  over-quantity, **or any other non-uuid `p`** (residual bypass) — is REJECTED
  (`errcode 23514`), mirroring the catalog missing-product reject.
- **(2) Price rewrite.** Each rfq line's `price` is overwritten authoritatively
  from `rfq_offer_items.price` inside the SAME `jsonb_agg` normalization that
  rewrites catalog prices from `products.price` — "server price wins, silently"
  (`20260727` rule (b)). A **no-op for an honest order** (the client already sends
  the offer price); a tampered price is corrected. The subtotal/fee/total recompute
  is unchanged and now runs on corrected inputs (RFQ keeps its present retail-fee
  treatment — rfq lines resolve to `seller_vendor_id`, `v_wholesale` stays false).
- **Preserved verbatim:** admin (`is_admin()`) bypass — admins may still create/
  correct RFQ or wholesale orders with custom prices; non-admin UPDATE pinning;
  the catalog missing/hidden/priceless reject; byAmount D1/D2; the wholesale branch;
  the retail fee formula + free-delivery promotion.
- **Cast hardening (bug found during verification).** The existing `(p)::uuid`
  casts are guarded only by an *adjacent* regex; Postgres evaluated the cast
  **eagerly** in some plans (a standalone probe errored on `rfq-…`). The live
  trigger short-circuits today, but adding the `roi` join to the normalization
  could destabilize it. Every uuid cast in the blocks this migration touches (the
  new reject block + the extended normalization, **both** the `roi` and the catalog
  `pr` join) is now **`CASE`-guarded on a STRICT uuid regex**, so a malformed rfq id
  fails **closed** as a clean reject, never a raw cast error. Behaviour is identical
  to the pre-image for every well-formed line.

Non-RFQ note: rfq line prices are normalized to the source type `numeric(14,2)`
(e.g. `255` → `255.00`) — jsonb-equal, `255*22 = 5610` unchanged, no client/monetary
impact (same as the catalog shield writing `products.price`). Pre-image at
`supabase/rollback/20260735_orders_rfq_price_crosscheck_preimage.sql`
(restores `md5 64c79140f968d4e4867c267e0d8fd48e`). No data modified (INSERT-time
logic only; settled orders frozen by the UPDATE pin).

### Investigation of existing prod data (before apply)

- **3 RFQ orders** exist (`632952`, `758868`, `924379`), all `delivered`,
  single-line/single-seller. **All already match their accepted offers exactly** —
  price (255/255, 666/666, 33/33), qty (22≤22, 9≤9, 6≤6), `status='accepted'`,
  buyer & seller both match. No tampering, no legacy drift.
- **Whole-table line inventory:** 35 catalog-uuid lines + 3 valid `rfq-<uuid>`
  lines, **zero** junk/other non-uuid lines. So this migration rejects nothing that
  exists and needs **no backfill**.

### Replica verification (read-only against real prod data, then a rolled-back live smoke — all non-persisting)

- **Reject truth table, 11/11** over crafted payloads built from real buyer/seller/
  offer fixtures: honest & tamper-price-low → allow; over-qty(23>22), zero-qty,
  junk-uuid, malformed `rfq-junk`, foreign-buyer, foreign-seller, unaccepted-pending,
  other-non-uuid → all **reject**; catalog-uuid → ignored by the block. Price rewrite:
  tampered `price:1` → `255.00`.
- **Byte-identity replay on all 3 live RFQ orders:** `would_reject=false`, normalized
  `items` jsonb-equal to stored (`=` true); total unchanged.
- **Live rolled-back smoke** (new fn installed inside a `DO` block that `RAISE`s to
  force full rollback; inserts run as the real `authenticated` buyer
  `82e0811f…`, `is_admin=false`): **T1 tamper (price 1)** → `stored_price=255.00`,
  `total=6610`, `fee=1000`, and the AFTER-trigger `order_seller_groups.subtotal=5610.00`
  (make_groups/sync integration confirmed); **T2 over-qty / T3 junk-uuid / T4
  unaccepted-pending / T5 other-non-uuid** → all rejected (PRICE_INTEGRITY); **T6
  fully honest (255)** → `total=6610`. Post-smoke: `orders` 22, residue **0**, live fn
  still `64c79140…` (nothing persisted).

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260713124240`).

- **Function switched.** `md5(pg_get_functiondef(...))` `64c79140f968d4e4867c267e0d8fd48e`
  → **`01ee2d20af222de879ac0efd200922e6`**. Trigger `trg_orders_enforce_delivery_fee`
  still bound & enabled.
- **Security advisor:** **55 → 55, delta 0** (no lint added/removed; the function is
  not flagged — pure `CREATE OR REPLACE`, no new function/grant/RLS/table).
- **No data touched.** `orders` row count 22 before and after; smoke residue 0; the 3
  existing RFQ orders unchanged.

### Client cutover

**None required.** The client already sends the accepted-offer price; the server is
now the authoritative check. The RFQ checkout continues to use the normal
single-vendor checkout INSERT — it simply can no longer carry a tampered or
unaccepted rfq line.

---

## 2026-07-13 — `20260734_products_realtime_publication` — ✅ APPLIED (server, Realtime Phase 2 — Step 2a server enablement)

Realtime **Phase 2** (products / offers / savings) — **server enablement only**.
Adds `public.products` to the `supabase_realtime` publication so Postgres emits
change events for it, and strips `anon`'s latent **write** DML on the table.
**anon SELECT is deliberately KEPT** — visitor browsing stays open (anon must keep
reading products). One table covers all three Phase-2 surfaces: the product feed,
the "offers/العروض" flags (`limited_offer_enabled` / `limited_offer_ends_at`
columns) and the customer "savings/التوفير" section (`category='savings'`) are all
rows of `public.products`. (`savings_products` is unused by the client;
`product_sold_counts` is a VIEW over `orders` and cannot be published — neither is
touched.) **Client untouched** — no live behavior changes until the 2a client
increment ships. Rollback pre-image at
`supabase/rollback/20260734_products_realtime_publication.sql`.

### What it changes

- **(1)** guarded `alter publication supabase_realtime add table public.products`
  (idempotent `pg_publication_tables` existence check). This is the ENTIRE server
  requirement: no schema change, **no REPLICA IDENTITY change**, no new RLS policy,
  no new grant. The client subscribes to INSERT + UPDATE only (never `'*'`) and
  re-fetches the product list on each event (never reads the payload), so the
  default (primary-key) replica identity authorizes each subscriber against the NEW
  record via the existing SELECT policies. DELETE is intentionally excluded
  (Realtime does not apply RLS to DELETE); a hard `DELETE` therefore does not
  propagate live — **accepted by decision** (it clears on the next natural reload;
  the price-integrity trigger already blocks ordering a missing product). The common
  "hide from storefront" action is a soft-hide UPDATE (`status='hidden'`), which
  DOES propagate.
- **(2)** `revoke insert, update, delete on public.products from anon` — removes
  latent write surface (mirrors the `20260726` treatment of `order_seller_groups`).
  RLS already denied anon writes (`own_products` / `products_*_own` require
  `auth.uid()=vendor_id`; the admin policies require `is_admin()`), so no legitimate
  path changes. **anon SELECT NOT revoked.** `authenticated` grants untouched
  (Realtime evaluates RLS against the base table and needs `authenticated` to hold a
  direct SELECT grant — confirmed still present).

**RLS posture — DECISION "A" (unchanged):** the two permissive SELECT policies OR
together — `read_products (status='available')` and `products_select_all (USING
true, PUBLIC)` — so every product row stays SELECT-authorized. This is what makes
the soft-hide pattern work over Realtime: the `status→'hidden'` UPDATE is delivered,
the client re-fetches, `rowToProduct` sets `active=false` and the card drops. The
flip side (`products_select_all` also makes hidden rows + all columns anon-readable —
already true via REST today, NOT introduced here) is left UNCHANGED and tracked as a
SEPARATE future hardening ticket.

### Replica verification (rolled-back txn on live prod data — real RLS, as anon AND authenticated)

Forward migration applied inside a `BEGIN … ROLLBACK`, then probed per role:

- **publication:** `products_in_publication` = **yes** (after apply, inside the txn).
- **grant layer (`has_table_privilege`):** anon SELECT **true**; anon
  INSERT/UPDATE/DELETE **false**; authenticated SELECT/INSERT/UPDATE/DELETE **all
  true** (unchanged).
- **actual attempts under `set local role`:** as **anon** → `select` **SUCCEEDED
  (rows=30)**, `insert`/`update`/`delete` all **rejected** (`permission denied for
  table products`); as **authenticated** → `select` **SUCCEEDED (rows=30)**.
- **rollback confirmed clean:** post-rollback live re-check equalled the pre-apply
  baseline (`products_in_publication`=no, anon SELECT & INSERT grants both true) —
  nothing persisted.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260713074052`).

- **Publication membership (public schema):**
  - **Before:** `chat_flag_alerts, conversations, messages, notifications, order_seller_groups, orders, rfq_flag_alerts`
  - **After:**  `chat_flag_alerts, conversations, messages, notifications, order_seller_groups, orders, products, rfq_flag_alerts`
- **`anon` grants on `public.products`:**
  - **Before:** `SELECT, INSERT, UPDATE, DELETE`
  - **After:**  `SELECT` (INSERT/UPDATE/DELETE revoked; **SELECT retained**)
- **`authenticated` grants on `public.products`:** `SELECT, INSERT, UPDATE, DELETE`
  — **unchanged** (Realtime SELECT authz requirement satisfied).
- **Security advisor:** **55 → 55**, delta **0** (none added, none removed).
- **No data touched** (publication + grant DDL only).

### Client increments (pending — separate commits, this feature branch)

- **2a products feed:** an app-level `products-feed` channel in the root `App`
  (`INSERT`+`UPDATE`, 350 ms-debounced re-fetch → `setDbProducts`,
  `visibilitychange` reconnect, `try/catch` silent degrade). Product cards and the
  product-detail page (both derived from the live list) refresh with no manual
  reload.
- **2b prices** (re-run the cart reconcile on live product-list changes; the server
  price-rewrite trigger stays the authoritative safety net) and **2c offers/savings**
  (verify they refresh under the same 2a channel) land as their own commits.

---

## 2026-07-13 — `20260733_drop_orders_commission_sync_ins` — ✅ APPLIED (server, Step 6 cleanup 2/2)

Drops the dormant `AFTER INSERT` commission hook `trg_orders_commission_sync_ins`
(function `orders_commission_sync_ins()`). It charged commission only if an order
was **inserted already** at `status='delivered'` — a path no code exercises:
checkout (`app.main.js`, single- and multi-seller) hard-codes `status:'new'`, the
column default is `'received'`, and admin only transitions orders via
`admin_set_order_status()` (an UPDATE). The **real** charge is the status→delivered
UPDATE path (`trg_orders_commission_sync` → `orders_commission_sync()` →
`charge_commission`); all 9 delivered orders in prod were charged that way.

Not merely dormant — a latent footgun. `AFTER INSERT` triggers on `orders` fire
alphabetically (`trg_decrement_stock` → `trg_orders_commission_sync_ins` →
`trg_orders_make_groups`), so since Step 4 (`20260724`, where `charge_commission`
loops `order_seller_groups`) an insert-as-delivered would run this hook **before**
the groups exist → charge nothing **and** leave `commission_state` NULL, with no
later UPDATE to re-trigger (silent under-charge). It provides no safety and hides a
trap. Pre-image at
`supabase/rollback/20260733_drop_orders_commission_sync_ins_preimage.sql`
(re-creation is one function + one trigger). No data modified.

### Replica verification (as `authenticated` where relevant, each in `BEGIN … ROLLBACK` on live prod data)

- **`pg_depend`:** the only dependant of `orders_commission_sync_ins()` is its own
  trigger `trg_orders_commission_sync_ins` — nothing else references it.
- **Surviving triggers** (after a rolled-back DROP): `trg_decrement_stock`,
  `trg_orders_commission_sync` (the UPDATE charge path), `trg_orders_make_groups`,
  `trg_orders_enforce_delivery_fee` — all intact.
- **Charge-exactly-once via the UPDATE path** (INS hook dropped, order `266621`
  `new`→`delivered`): `commission_state` null→`charged`, `commission_amount`
  **832.50**, exactly **1** group charged, seller retail counter **+50000.00**;
  re-invoking `charge_commission` is a guarded no-op (amount unchanged) —
  `idempotent_no_double_charge = true`. Rolled back.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260713071150`).

- **Pre-apply guard.** `trg_orders_commission_sync_ins` confirmed still present.
- **After apply.** `ins_trigger_still_present = false`, `orders_commission_sync_ins`
  function count = **0**; surviving triggers on `orders` = `trg_decrement_stock`
  [AFTER INS], `trg_orders_commission_sync` [AFTER UPD], `trg_orders_enforce_delivery_fee`
  [BEFORE INS UPD], `trg_orders_make_groups` [AFTER INS].
- **No data touched** (DDL only; the money chain's UPDATE charge path is unchanged).

---

## 2026-07-13 — `20260732_has_purchased_from_group_based` — ✅ APPLIED (server, Step 6 cleanup 1/2)

Rewrites review-eligibility `has_purchased_from(uuid)` from the single
`orders.seller_vendor_id` rule to a **group-based UNION rule**. A unified retail
order stores ONE `seller_vendor_id` (the primary) but the real per-seller
relationship lives in `order_seller_groups`, so a customer who bought from N
sellers in one order could review only the primary (and could wrongly review the
primary when the primary's slice was rejected while the order still delivered via
others). Client half (its own commit): `app.catalog.js` `canReview` now calls
`rpc('has_purchased_from', {p_vendor})` so the "write a review" button shares one
source of truth with the `reviews_insert_own` RLS `WITH CHECK` (the function's
**only** DB reference).

### The rule (UNION) and why `orders.status` is authoritative for "delivered"

The customer may review seller S iff they own a **non-rejected**
`order_seller_groups` row for S whose order reached them:
`g.seller_id = p_vendor` AND `g.seller_decision IS DISTINCT FROM 'rejected'` AND
`g.fulfillment_status <> 'rejected_at_hub'` AND
(`o.status IN ('delivered','done')` **OR** `g.fulfillment_status='delivered_to_customer'`).

`orders.status` (set by `admin_set_order_status()`, the customer lifecycle) is the
authoritative "delivered to customer" signal — today's rule already uses it — while
a group's `delivered_to_customer` (set by a **separate** admin action, `admin.js`)
can lag. **Known drift example (no reconciliation performed):** live order `830586`
is `status='delivered'` with its group still `out_for_delivery`/`pending`; the
UNION rule covers this via the `orders.status` branch, whereas a strict
`delivered_to_customer`-only rule would have regressed it. The
`delivered_to_customer` OR-branch is defensive/forward-compat (currently redundant,
since every such group sits in a delivered order).

Single in-place `CREATE OR REPLACE` (same signature / STABLE / SECURITY DEFINER /
search_path) → ACL preserved (`authenticated`=EXECUTE, `anon`=none). The only
reference is the `reviews_insert_own` `WITH CHECK` on INSERT, so redefining the
function **cannot orphan or re-validate any existing review** (verified: the 3
existing reviews are unaffected; one was already invalid under both old and new
rules, pre-existing). Pre-image at
`supabase/rollback/20260732_has_purchased_from_group_based_preimage.sql`. No data
modified.

### Replica verification (as `authenticated`, each in `BEGIN … ROLLBACK` on live prod data — real RLS)

- **Backward compat, comprehensive:** OLD vs UNION vs STRICT over all **12** real
  (customer, seller) pairs → `regressions_union = 0` (no currently-eligible pair
  loses eligibility), `regressions_strict = 1` (strict would drop the `830586`
  outlier — why UNION was chosen). `gap_fixed_union = 0` on today's data is
  expected (every delivered order is single-seller; the multi-seller fix is
  forward-looking).
- **Named cases:** A eligible `5c821a81→9d52fae2` old/union/strict = **T/T/T**;
  **B outlier `d64fe722→66563bfb` = T/T/F** (UNION keeps it, STRICT drops it);
  C ineligible `d64fe722→9dfa8c65` = **F/F/F**.
- **Synthetic multi-seller (as the customer under RLS):** one delivered order, three
  groups — A `delivered_to_customer`/accepted → old **T**, union **T**; B
  `out_for_delivery`/accepted → old **F** (the gap) → union **T** (fixed); C
  `pending_hub_delivery`/rejected → old **F**, union **F** (correctly denied). Two
  non-rejected sellers allowed, the rejected one denied. Rolled back.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260713071112`).

- **Pre-apply guard.** Live `md5(pg_get_functiondef(...))` =
  `91f4972b7d6ab1a882bfbad199d4200b` (the seller_vendor_id body — not drifted).
- **Function switched.** After apply → `d03df0e21481aa838efe27cf63fbde07`;
  `authenticated` retains EXECUTE, `anon` still has none.
- **Live smoke (rolled back, as `authenticated`).** Eligible pair
  `5c821a81→9d52fae2` → **true**; ineligible pair `d64fe722→9dfa8c65` → **false**.
- **No data touched** (function-only; all test rows rolled back — reviews 3 /
  orders 22 / groups 29 unchanged).

---

## 2026-07-12 — `20260731_orders_seller_facing_failopen_items` — ✅ APPLIED (server, Phase B fix)

Fixes the deleted-product edge in `20260730`. That migration filtered `items` to the
caller's own lines but, when a line's product could not be resolved, fell back to the
order's primary `seller_vendor_id`. On a multi-seller order that mis-handles a deleted
product: if a SECONDARY seller's product row is deleted, their line resolves to NULL →
falls back to the primary → the line **vanishes from its true owner** (who must still
fulfil it) and **leaks onto the primary**. Verified live (rolled-back): deleting seller
`9d52fae2`'s product on `983057` gave `9d52` → **0** items, primary `66563` → **6**.

### What it changes (one-token fix)

The `items` filter predicate `coalesce(resolved_vendor, o.seller_vendor_id) = auth.uid()`
becomes `coalesce(resolved_vendor, auth.uid()) = auth.uid()` — the fallback for an
**unresolvable** line changes from the primary to the caller, i.e. it **fails OPEN**:

- resolvable & mine → keep (isolated, unchanged);
- resolvable & another's → drop (isolated, unchanged);
- **unresolvable (deleted product / non-uuid RFQ `p`) → keep for EVERY seller** on the
  order, so an orphaned line never disappears from the seller who must fulfil it.

In-place `CREATE OR REPLACE` (items expression only); `is_admin()` / NULL items pass
through; grants preserved.

### Replica verification (as `authenticated`, rolled-back on live prod data)

- **Byte-identical to live `20260730` on current data:** with no products deleted every
  line resolves, so the fallback is never used — **0 rows changed** across all of a
  seller's orders (single- and multi-seller), and single-seller items unchanged.
- **Deleted-product fail-open** (delete `9d52fae2`'s product `55fcc075` on `983057`):
  the orphaned line now appears for its true owner **and** the other sellers, vanishing
  from no one — `9d52` → 1 (own orphan), `9dfa` → 2 (own + orphan), `66563` → 6
  (own 5 + orphan), admin → 7. Resolvable lines stay isolated (`9dfa` keeps its own,
  `66563` its 5).
- **Prod untouched by the tests:** live view md5 stayed `748ba6bb79b34b83fd25208e6092d90c`
  throughout; test product restored on rollback.

**Trade-off (accepted):** an unresolvable line is over-shown to the order's other
sellers — but only orphaned/RFQ lines, only on multi-seller orders.

Pre-image at `supabase/rollback/20260731_orders_seller_facing_failopen_items_preimage.sql`.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260712201926`).

- **Pre-apply guard.** Live md5 `748ba6bb79b34b83fd25208e6092d90c` (the `20260730` state
  — not drifted).
- **View switched.** After apply → `4c7250e9aa9868d9da41867d0d11c4b6`; `authenticated`
  (and `anon`) SELECT grants preserved.
- **Live smoke (rolled-back, as `authenticated`).** Resolvable isolation intact: seller
  `9d52fae2` sees **1** own item on multi-seller `983057`; single-seller `879561`
  unchanged — matches the replica (fail-open only alters the deleted-product edge).
- **No data touched** (view-only).

### DEFERRED hardening (approved, NOT in this change) — per-item `vendor_id` snapshot

The precise alternative to fail-open: stamp each order line's `vendor_id` (authoritatively
from `products.vendor_id`) onto `orders.items` **at order creation**, inside the existing
price-integrity trigger `lozi_orders_enforce_delivery_fee` (adding a `v` field to both
uuid branches — the byAmount `jsonb_build_object` rebuild and the normal-item `jsonb_set`
patch), plus a one-time backfill of existing orders. The view would then resolve each line
by its stamped `v`, so attribution survives product deletion exactly. Deferred because it
touches the **order-creation money-chain trigger** and cannot reliably backfill lines whose
product is **already** deleted (that mapping is unrecoverable). It is a companion to the
existing "unify product price semantics" backlog item under `20260727` — both touch the
order-creation path and should ship together with coordinated replica verification.

---

## 2026-07-12 — `20260730_orders_seller_facing_own_items` — ✅ APPLIED (server, Phase B)

Unified-cart **Step 2c — Phase B (server half)**. The Phase-B client cutover drops the
`.eq('seller_vendor_id', uid)` filter so every seller on a unified order sees their
slice (row + status isolation comes from the view's group-membership WHERE + RLS). But
the view still returned the FULL `o.items`, so on a shared multi-seller order each
seller's card would render the OTHER sellers' items. This migration filters `items` to
the caller's own lines — resolve each line's vendor via `products.vendor_id`, else fall
back to `o.seller_vendor_id` (which also attributes RFQ/non-uuid `p` lines to the
primary), mirroring the admin Hub panel's `groupItems`.

### What it changes

- Only the `items` column expression changes (same name/type/position), so it's an
  in-place `CREATE OR REPLACE VIEW` — no column add/remove, grants preserved.
- `is_admin()` and NULL `items` pass through unchanged; non-admin gets the own-items
  jsonb (empty `[]` when none match — never falls back to the full list, so no leak).

### Replica verification (as `authenticated`, rolled back on live prod data)

- **Single-seller item byte-identical:** seller `9d52fae2`, live-view vs new-view →
  5 single-seller orders, **0 items changed**; the 3 multi-seller orders' items changed
  (filtered), as expected.
- **Per-seller item isolation on `983057`** (7 lines across 3 sellers): `9d52fae2` → **1**
  (own `55fcc075`), `9dfa8c65` → **1** (own `2c10ef5c`), `66563bfb` → **5** (own), admin
  (`5c821a81`) → **7** (all). 1+1+5 = 7 — no leaks, no dropped lines.
- **Row/status isolation (from the client filter removal), proven separately:** seller A
  sees 8 orders, seller B 3, sharing 2 (incl. `983057`); `a_leak=0 / b_leak=0` — neither
  sees an order where it owns no group.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260712181357`).

- **Pre-apply guard.** Live md5 `c98d89bc7682fbd77c3cd590f76d2154` (the Phase-A state —
  not drifted). **After apply →** `748ba6bb79b34b83fd25208e6092d90c`; `authenticated`
  SELECT grant preserved.
- **Live smoke (rolled-back, as `authenticated`).** Seller `9d52fae2` on `983057` →
  **1 item** (own only); single-seller order `879561` unchanged.
- **No data touched** (view-only).

### Phase B client (same feature branch)

`app.main.js`: accept edge → `rpc('seller_accept_group')` (no optimistic status, relies
on realtime reload); reject → `rpc('seller_reject_group', {p_reason})` (optimistic own
slice, re-syncs on error); dropped the `seller_vendor_id` filter; mapper prefers the
group's `decline_reason`. `app.seller.js` + `app.data.js`: two preset reject reasons
(`نفاد الكمية`, `لا يمكن التجهيز حالياً`). `canReject` stays `{new, preparing}`
(= server gate: `paid_by_customer` + rank ≤ 1). Client-only, no merge.

---

## 2026-07-12 — `20260729_orders_seller_facing_seller_decision` — ✅ APPLIED (server)

Unified-cart **Step 2c — Phase A** (view augmentation). Step 2b (`20260720`) added
`seller_decision` (pending|accepted|rejected) + the manual-refund flag to
`order_seller_groups`, but `orders_seller_facing.internal_status` was still derived
only from the ORDER aggregate + the group's `fulfillment_status`. In a multi-seller
order a seller who had already accepted or rejected THEIR slice couldn't see it:
while the other sellers stayed pending the order sat at `new` (rank 0), so the
seller's card kept showing `new` with live accept/reject buttons — their own
decision appeared lost. This migration makes the CALLER's own group decision drive
`internal_status`, and exposes `decline_reason` + `refund_owed_yer` for the Phase-B
seller "you declined this slice — X ر owed back" banner.

### What it changes (single `CREATE OR REPLACE VIEW`, security_invoker preserved)

- **Two additive `internal_status` CASE branches:**
  - `g.seller_decision = 'rejected'` → `'rejected'` (placed after the order-level
    `rejected`/`cancelled` branches; a multi-seller order continues, but the
    rejecting seller's own card now reads `rejected`).
  - `g.seller_decision = 'accepted' AND g.fulfillment_status = 'paid_by_customer'
    AND order_status_rank(o.status) = 0` → `'preparing'` (I accepted; the order has
    not flipped yet because other sellers are still pending).
- **Three additive columns appended at the TAIL** (`CREATE OR REPLACE VIEW` may only
  add columns to the end, never reorder): `seller_decision`, `decline_reason`,
  `refund_owed_yer`. Ignored by today's client mapper; the Phase-B client reads them.
- Admin (`is_admin()`) keeps the pre-existing "first group" projection.

Pre-image at `supabase/rollback/20260729_orders_seller_facing_seller_decision_preimage.sql`
(restores the exact 23-column pre-Phase-A view via **DROP + recreate + re-grant** —
column removal is impossible with `CREATE OR REPLACE`; the view has no SQL
dependents, is in no realtime publication, and holds no own RLS, so the DROP is
safe). No data modified (view-only).

### Single-seller byte-identical — why the new branches never fire on legacy rows

- The `own rejected → rejected` branch sits AFTER `o.status='rejected'`. On a
  single-seller order `seller_decision` becomes `'rejected'` ONLY when the order is
  also `'rejected'` (`seller_reject_group` recompute → `status='rejected'`; the 2a
  backfill matched), so the order-level branch already fires — the new branch is
  unreachable.
- The `own accepted → preparing` branch only fires while `order_status_rank(o.status)
  = 0` (new/received/payreview). A single-seller accept always flips the order to
  `preparing` (rank 1), so a single-seller rank-0 order is always still `pending` —
  the new branch is likewise unreachable.

### Replica verification (as non-superuser `authenticated`, each inside a `BEGIN … ROLLBACK` on live prod data — real RLS + real RPCs, zero persistence)

Simulated per-seller via `set_config('request.jwt.claims', …)` + `set local role
authenticated` (verified `auth.uid()` resolves and the view scopes per seller):

- **Case 1 — single-seller byte-identity:** seller `9d52fae2`, live view vs new view
  → 8 rows, **0 changed**, 0 missing.
- **Byte-identity, comprehensive:** OLD-vs-NEW `internal_status` over **every** real
  order×group pair → **29/29 identical** (incl. all 19 single-seller pairs).
- **Case 2 — multi-seller `983057`, `9d52fae2` accepts** (real `seller_accept_group`):
  order stays `new`; my row `internal_status=preparing`, `seller_decision=accepted`;
  the OTHER seller `9dfa8c65` **unaffected** (`new` / `pending`).
- **Case 3 — multi-seller `983057`, `9d52fae2` rejects** (real `seller_reject_group`,
  reason `نفاد الكمية`): order **continues** (`new`, 2 sellers remain); my row
  `internal_status=rejected` + `decline_reason=نفاد الكمية` + `refund_owed_yer=25250`;
  the OTHER seller **unaffected**. Fee recalc verified: `old_fee 1500 (3 sellers) −
  lozi_delivery_fee(2)=1250 → fee_diff 250`; `refund = 25000 + 250 = 25250`;
  `refund_status='pending'`.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260712175641`).

- **Pre-apply guard.** Live `md5(pg_get_viewdef(orders_seller_facing, true))` =
  `19efec02e1b859b0a51dc0b4f22bf12b` (matched the investigation baseline — not drifted).
- **View switched.** After apply → `c98d89bc7682fbd77c3cd590f76d2154`; the three new
  columns (`seller_decision, decline_reason, refund_owed_yer`) are present and
  `authenticated` retains its `SELECT` grant.
- **Live smoke (rolled-back, as `authenticated`).** Real single-seller order `879561`
  (`status=delivered`, seller `9d52fae2`) → `internal_status=delivered`,
  `seller_decision=accepted`, `decline_reason`/`refund_owed_yer` null — correct.
- **No data touched** (view-only; the Case 2/3 RPC calls were rolled back — group
  decision counts unchanged at 9 accepted / 1 rejected).

### Client cutover — Phase B / C (pending)

The RPCs (`seller_accept_group`, `seller_reject_group`) and grants have been live since
Step 2b; Phase A only unblocks the seller UI. **Phase B** (seller client cutover to the
RPCs + drop the `.eq('seller_vendor_id', uid)` filter + preset reject reasons) and
**Phase C** (admin refund panel) are pure client and land as separate commits.

### DEFERRED (approved — NOT in this change)

- **D-ii — customer-facing partial-rejection line.** A line on the customer order card
  indicating a seller declined part of the order and a refund is pending. The
  `seller_rejected` notification (from `20260720`) already satisfies the Step-2
  "customer can see a seller declined" rule, so this is polish. Surfacing it on the
  card would need a small additive flag/aggregate on `orders_customer_facing` (e.g.
  `has_rejected_seller` / aggregated `refund_owed`) + client rendering; **replica-verify
  if pursued.** Deferred by decision on 2026-07-12.

---

## 2026-07-12 — `20260728_orders_byamount_reinstate` — ✅ APPLIED (server)

Re-enables the **byAmount** ("buy N riyals worth") purchase path under the price-
integrity regime (the DEFERRED item from `20260727`). A byAmount line now carries
**intent only** — `{p, mode:'amount', amount}` — and the `BEFORE INSERT/UPDATE`
trigger `lozi_orders_enforce_delivery_fee` derives everything authoritatively from
`products.price`, at the top of the non-admin INSERT branch (before the subtotal
CTE) so the corrected line flows into `v_subtotal`, `NEW.total`, `NEW.items` and
every AFTER trigger:

```
price := products.price
grams := floor(amount / price * 1000)     -- always round DOWN
q     := grams / 1000.0
line  := price * q                        -- <= amount, never above
weight := '≈ <grams> جم'
```

Tampering is neutralized: a forged `price`/`q`/`weight` is ignored (re-derived); a
forged `amount` only means the customer pays that amount.

### What it changes (single `CREATE OR REPLACE`, one function)

- **Scope (D1 — quarter categories only):** honors `mode='amount'` **only** for
  `almond`/`raisin`/`savings`, where `products.price` is per-kilogram (weight basis
  1 kg) so the client's grams preview equals the server's. `mode='amount'` on any
  other category (retail/vip/**wholesale**) or a **non-uuid (RFQ)** id is REJECTED —
  which also excludes wholesale/RFQ (defense-in-depth; the client never offers it).
- **Reject (D2):** `mode='amount'` with non-positive amount, non-positive product
  price, or an amount that buys **< 1 gram** → REJECT (`errcode 23514`, Arabic
  message).
- **Preserved verbatim from `20260727`:** admin (`is_admin()`) bypass, non-admin
  UPDATE pinning, the missing/hidden/priceless reject, RFQ (non-uuid) exemption, the
  subtotal/fee/total recompute and the wholesale delivery branch. The **non-byAmount
  path is byte-identical** (verified). `decrement_stock` already subtracts the
  fractional `q`; `sync_order_seller_groups` sums the corrected `price*q` into
  `order_seller_groups.subtotal_amount` → per-seller commission → payout.

Pre-image at `supabase/rollback/20260728_orders_byamount_reinstate_preimage.sql`.
No data modified (INSERT-time logic only).

### Replica verification (local Postgres 16, seeded read-only from prod)

Faithful replica (9 chain-tables verbatim DDL + enums, money-chain functions
verbatim, 8 triggers, RLS + policies + grants, real product/profile/tier rows).
Baseline reproduced live byte-for-byte: `md5(pg_get_functiondef(...)) =
6d04b08eee94abe48b85e5e7ca6b0309`. All assertions run `set role authenticated`
(non-superuser), each in a rolled-back txn — all green:

- honest 18500 of almond @37000/kg → `q 0.500`, `price 37000`, `weight ≈ 500 جم`,
  `line 18500`, `total 19500`, fee 1000, OSG subtotal 18500, stock 2→**1.5**; driven
  to `delivered` → commission **348.75**, seller retail counter 0→18500;
- **tamper** (`q:99, price:5, weight:fake`) → re-derived to the honest outcome;
- rejects: amount≤0, sub-gram (36<37/g), retail `mode='amount'`, wholesale
  `mode='amount'`, missing product, hidden product — all rejected;
- multi-seller (18500@37000 + 8500@17000) → total 28250, fee 1250, subs 18500/8500,
  commissions 348.75/170.00, order 518.75;
- **non-byAmount order → byte-identical** OLD vs NEW (total 92250, prices rewritten,
  q kept);
- admin insert → tampered price/total **preserved**;
- rollback pre-image re-run → restores `6d04b08eee94abe48b85e5e7ca6b0309` exactly.

### Live apply evidence (prod `niloddwnllhsvrmuxfxw`)

Applied via `apply_migration` (recorded `schema_migrations.version 20260712071149`).

- **Pre-apply guard.** Live `md5(pg_get_functiondef(lozi_orders_enforce_delivery_fee))`
  = `6d04b08eee94abe48b85e5e7ca6b0309` (unchanged since investigation → not drifted).
- **Function switched.** After apply → `64c79140f968d4e4867c267e0d8fd48e`.
- **Live smoke (rolled-back, non-persisting).** Honest byAmount INSERT as
  `authenticated` (customer `d64fe722…`, almond @37000, amount 18500), executed
  inside an atomic `DO` block that raises to force rollback:
  `q=0.500 price=37000 weight=[≈ 500 جم] line=18500 total=19500 fee=1000
  osg_subtotal=18500.00` — matches the replica exactly.
- **No data touched.** `orders` count 22 before and after; smoke residue 0; almond
  stock still 2 (rolled-back decrement undone).

### byAmount reinstatement — ✅ COMPLETE (phases 1–3, quarter-only, launched 2026-07-12)

- **Phase 1 — server (this migration).** ✅ Applied to prod 2026-07-12 as `20260728`
  (see above): intent-only `{p, mode:'amount', amount}`; trigger derives grams/q/line
  authoritatively; quarter categories only.
- **Phase 2 — client cutover.** ✅ Live in `main` (commit `b2c9624`). The client sends
  intent-only (`{p, mode:'amount', amount}`), re-derives grams from live price with
  `Math.floor`, upgrades any legacy persisted byAmount cart line to the new shape on
  reconcile, and reads back the authoritative order via `.select().single()` (rendering
  items/total/grams from it; status still from the customer-facing view).
- **Phase 3 — launch (guard removal).** ✅ Done 2026-07-12. Removed the disable guard in
  `src/scripts/app.shop.js` (`buy-mode` block): `isConsumer && !p.bundle && false/*…*/`
  → `isQuarter && !p.bundle`. The byAmount toggle now renders **only** for
  `almond`/`raisin`/`savings` (quarter-only) and stays hidden on retail/vip/wholesale/
  bundle/RFQ — the client gate matches the server's category check exactly.

### Still deferred (unchanged)

- **Unify product price semantics (byAmount beyond quarter cats).** See the deferred
  backlog item under `20260727`.

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
  categories only; rejects non-positive/sub-gram/non-quarter). **Applied to prod
  2026-07-12 (server) as `20260728`; client cutover (Phase 2, commit `b2c9624`) and
  guard removal/launch (Phase 3) COMPLETE 2026-07-12 — quarter-only. See the top
  entry.**
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
