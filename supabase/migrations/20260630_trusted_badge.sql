-- ============================================================================
-- Lozi — Prestige "موثّق" trusted badge (earned by performance + admin-controlled)
-- Applied to project niloddwnllhsvrmuxfxw on 2026-06-30. Idempotent.
--
-- IMPORTANT distinction (kept separate on purpose):
--   * Account verification (vendor_verifications.status = 'approved') only
--     unlocks the right to publish products. It grants NO badge.
--   * Trusted badge (stores.trusted_badge) is a prestige mark, EARNED by
--     performance (ratings_count > 100 AND average_rating >= 4.5) or granted by
--     an admin. A verified account does NOT automatically get it.
--
-- Granting:  AUTO (badge_source='auto') when criteria first met, or
--            MANUAL (badge_source='manual') from the admin dashboard (any store).
-- Revoking:  MANUAL ONLY (admin). There is NO automatic revocation. When an
--            admin revokes, badge_blocked=true suppresses the auto rule so it
--            can never re-grant. Auto logic only ever GRANTS, never removes,
--            never overrides a 'manual' badge.
-- Security:  badge columns are writable ONLY by the auto rule (this file's
--            SECURITY DEFINER functions) or by an admin — never self-assigned
--            by a vendor. Enforced by a write-protection trigger (DB-level),
--            not just the UI.
-- ============================================================================

-- ── 1. Columns on the store record (reuse existing stores table) ────────────
alter table public.stores
  add column if not exists trusted_badge   boolean      not null default false,
  add column if not exists badge_source    text         check (badge_source in ('auto','manual')),
  add column if not exists badge_granted_at timestamptz,
  add column if not exists badge_blocked   boolean      not null default false,
  -- Rating aggregates maintained from public.reviews (single source of truth).
  add column if not exists ratings_count   integer      not null default 0,
  add column if not exists average_rating  numeric(3,2);

comment on column public.stores.trusted_badge   is 'Prestige موثّق badge. EARNED (auto) or admin-granted (manual). Never auto-revoked.';
comment on column public.stores.badge_source    is 'auto = met criteria; manual = admin grant. NULL when no badge.';
comment on column public.stores.badge_blocked   is 'Admin suppression flag. When true the auto rule must never (re)grant the badge.';

-- ── 2. Write-protection: only the auto rule or an admin may touch badge cols ─
-- The trusted functions below set lozi.badge_ctx=1 for their transaction; the
-- trigger lets that context (and admins) through and reverts everyone else.
create or replace function public.stores_protect_badge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.trusted_badge, NEW.badge_source, NEW.badge_granted_at, NEW.badge_blocked,
      NEW.ratings_count, NEW.average_rating)
     is distinct from
     (OLD.trusted_badge, OLD.badge_source, OLD.badge_granted_at, OLD.badge_blocked,
      OLD.ratings_count, OLD.average_rating) then
    if coalesce(current_setting('lozi.badge_ctx', true), '') = '1' or public.is_admin() then
      return NEW;  -- trusted context (auto rule) or admin: allow
    end if;
    -- Anyone else (e.g. a vendor editing their own store): revert badge columns.
    NEW.trusted_badge    := OLD.trusted_badge;
    NEW.badge_source     := OLD.badge_source;
    NEW.badge_granted_at := OLD.badge_granted_at;
    NEW.badge_blocked    := OLD.badge_blocked;
    NEW.ratings_count    := OLD.ratings_count;
    NEW.average_rating   := OLD.average_rating;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_stores_protect_badge on public.stores;
create trigger trg_stores_protect_badge before update on public.stores
  for each row execute function public.stores_protect_badge();

-- ── 3. Recompute aggregates + AUTO-GRANT only (never revoke) ────────────────
-- Called whenever a store's reviews change. Updates ratings_count/average_rating
-- and grants the auto badge the first time criteria are met. It must never
-- remove a badge, never override a 'manual' badge, and never re-grant when
-- badge_blocked is set by an admin.
create or replace function public.recompute_store_trust(p_vendor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_count int; v_avg numeric(3,2);
begin
  if p_vendor is null then return; end if;
  select count(*), round(avg(rating)::numeric, 2)
    into v_count, v_avg
  from public.reviews
  where store_vendor_id = p_vendor and coalesce(hidden, false) = false;

  perform set_config('lozi.badge_ctx', '1', true);

  update public.stores
     set ratings_count  = coalesce(v_count, 0),
         average_rating = v_avg,
         -- AUTO grant only: store has no badge, not blocked, criteria met.
         trusted_badge    = case when trusted_badge = false and badge_blocked = false
                                  and coalesce(v_count,0) > 100 and coalesce(v_avg,0) >= 4.5
                                 then true else trusted_badge end,
         badge_source     = case when trusted_badge = false and badge_blocked = false
                                  and coalesce(v_count,0) > 100 and coalesce(v_avg,0) >= 4.5
                                 then 'auto' else badge_source end,
         badge_granted_at = case when trusted_badge = false and badge_blocked = false
                                  and coalesce(v_count,0) > 100 and coalesce(v_avg,0) >= 4.5
                                 then now() else badge_granted_at end
   where vendor_id = p_vendor;
end;
$$;
revoke all on function public.recompute_store_trust(uuid) from public, anon, authenticated;

-- ── 4. Reviews trigger: keep aggregates/badge in sync ───────────────────────
create or replace function public.reviews_trust_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    perform public.recompute_store_trust(OLD.store_vendor_id);
    return OLD;
  end if;
  perform public.recompute_store_trust(NEW.store_vendor_id);
  if TG_OP = 'UPDATE' and NEW.store_vendor_id is distinct from OLD.store_vendor_id then
    perform public.recompute_store_trust(OLD.store_vendor_id);
  end if;
  return NEW;
end;
$$;
revoke all on function public.reviews_trust_sync() from public, anon, authenticated;
drop trigger if exists trg_reviews_trust_sync on public.reviews;
create trigger trg_reviews_trust_sync after insert or update or delete on public.reviews
  for each row execute function public.reviews_trust_sync();

-- ── 5. Admin grant / revoke (discretionary; admin-only) ─────────────────────
-- Grant: works for ANY store regardless of criteria. Marks source='manual' and
-- clears any suppression so the store keeps the badge.
create or replace function public.admin_grant_trusted_badge(p_vendor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  perform set_config('lozi.badge_ctx', '1', true);
  update public.stores
     set trusted_badge = true, badge_source = 'manual',
         badge_granted_at = now(), badge_blocked = false
   where vendor_id = p_vendor;
  if not found then raise exception 'store not found'; end if;
end;
$$;
revoke all on function public.admin_grant_trusted_badge(uuid) from public, anon;
grant execute on function public.admin_grant_trusted_badge(uuid) to authenticated;

-- Revoke: works for BOTH auto and manual badges. Sets badge_blocked=true so the
-- auto rule can never re-grant. Only an admin can lift the block (via grant).
create or replace function public.admin_revoke_trusted_badge(p_vendor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  perform set_config('lozi.badge_ctx', '1', true);
  update public.stores
     set trusted_badge = false, badge_source = null,
         badge_granted_at = null, badge_blocked = true
   where vendor_id = p_vendor;
  if not found then raise exception 'store not found'; end if;
end;
$$;
revoke all on function public.admin_revoke_trusted_badge(uuid) from public, anon;
grant execute on function public.admin_revoke_trusted_badge(uuid) to authenticated;

-- Lift the suppression without granting (lets the auto rule resume / admin re-grant).
create or replace function public.admin_unblock_trusted_badge(p_vendor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  perform set_config('lozi.badge_ctx', '1', true);
  update public.stores set badge_blocked = false where vendor_id = p_vendor;
  if not found then raise exception 'store not found'; end if;
  perform public.recompute_store_trust(p_vendor);  -- re-evaluate auto eligibility now
end;
$$;
revoke all on function public.admin_unblock_trusted_badge(uuid) from public, anon;
grant execute on function public.admin_unblock_trusted_badge(uuid) to authenticated;

-- ── 6. Admin views: current state + candidates for the badge ────────────────
create or replace view public.trusted_badge_candidates as
  select s.vendor_id, s.name, s.ratings_count, s.average_rating,
         s.trusted_badge, s.badge_source, s.badge_granted_at, s.badge_blocked,
         (s.ratings_count > 100 and coalesce(s.average_rating,0) >= 4.5) as meets_criteria,
         (s.ratings_count > 80  and coalesce(s.average_rating,0) >= 4.3) as near_criteria
  from public.stores s;
grant select on public.trusted_badge_candidates to authenticated;

-- ── 7. Backfill aggregates for existing stores (grants only where earned) ───
do $$
declare r record;
begin
  for r in select vendor_id from public.stores loop
    perform public.recompute_store_trust(r.vendor_id);
  end loop;
end $$;
