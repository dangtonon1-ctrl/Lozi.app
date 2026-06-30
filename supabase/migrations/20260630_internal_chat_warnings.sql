-- ============================================================================
-- Lozi — Internal chat, Section 14 additions:
--   (1) automatic warning to the SENDER on phone-number sharing (vendors only)
--   (2) real identity (first name + category) shown to chat participants
--   (3) three-strikes auto-suspension, enforced server-side
-- Applied to project niloddwnllhsvrmuxfxw on 2026-06-30. Idempotent.
--
-- REUSE (no rebuild): builds on 20260630_internal_chat.sql — the same
-- detect/flag pipeline (messages_flag_detect + flag_reasons), the same
-- after-insert trigger (extended here, not replaced wholesale), the existing
-- profiles.status used by the admin «المستخدمون» tab and the app's
-- isBlockedAccount() check, and the existing support_wa setting / openSupportWa.
-- ============================================================================

-- ── 1. Per-account warning counter (reuse profiles + its status column) ──────
alter table public.profiles
  add column if not exists warning_count    integer not null default 0,
  add column if not exists last_warned_at   timestamptz,
  add column if not exists suspended_reason text;
comment on column public.profiles.warning_count is
  'Number-sharing strikes. 3 => auto-suspended (status=suspended). Admin reactivation resets this to 0.';

-- ── 2. Helpers ───────────────────────────────────────────────────────────────
-- A blocked account (suspended/banned/deleted) may not publish or receive orders.
create or replace function public.is_suspended(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = p_user and status in ('suspended','banned','deleted')
  );
$$;
revoke all on function public.is_suspended(uuid) from public, anon;
grant execute on function public.is_suspended(uuid) to authenticated;

-- Vendor categories that the auto-warning applies to (farmers / retail / wholesale).
create or replace function public.is_vendor_role(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_role,'') in ('farmer','farmer_almond','farmer_raisin','retail','wholesale');
$$;

-- ── 3. In-app notifications (the warning channel) ───────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  type       text not null,                  -- 'warning' | 'suspended' | ...
  title      text,
  body       text,
  meta       jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
-- A user reads / marks-read their OWN notifications; admins read all. Inserts are
-- done by the SECURITY DEFINER trigger only (no user insert policy).
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications for delete
  using (public.is_admin());

-- ── 4. Extend the existing after-insert trigger: warn + count + auto-suspend ─
-- Keeps the original rollup + admin alert, and ADDS: when a flagged message
-- contains a PHONE NUMBER ('number' reason) and the sender is a vendor, warn the
-- sender, bump warning_count, and on the 3rd strike auto-suspend the account.
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role   text;
  v_status text;
  v_wc     integer;
begin
  -- (existing) conversation activity / preview / flag rollup
  update public.conversations
     set last_message_at      = NEW.created_at,
         last_message_preview = left(coalesce(NEW.body, ''), 140),
         flagged       = flagged or NEW.flagged,
         flagged_count = flagged_count + (case when NEW.flagged then 1 else 0 end)
   where id = NEW.conversation_id;

  -- (existing) admin alert for ANY flagged message
  if NEW.flagged then
    insert into public.chat_flag_alerts (conversation_id, message_id, sender_id, reasons)
    values (NEW.conversation_id, NEW.id, NEW.sender_id, NEW.flag_reasons);
  end if;

  -- (NEW · 14.1 + 14.3) phone-number sharing → warn vendor sender + 3-strikes
  if NEW.flagged and ('number' = any (NEW.flag_reasons)) then
    select role, status into v_role, v_status
      from public.profiles where user_id = NEW.sender_id;

    if public.is_vendor_role(v_role) then
      update public.profiles
         set warning_count  = warning_count + 1,
             last_warned_at = now()
       where user_id = NEW.sender_id
       returning warning_count, status into v_wc, v_status;

      insert into public.notifications (user_id, type, title, body, meta)
      values (NEW.sender_id, 'warning', 'تحذير',
              'تحذير: مشاركة أرقام التواصل مخالفة لقواعد التطبيق',
              jsonb_build_object('warning_count', v_wc, 'conversation_id', NEW.conversation_id));

      -- Third strike → suspend (only if not already blocked).
      if v_wc >= 3 and coalesce(v_status, 'active') not in ('suspended','banned','deleted') then
        update public.profiles
           set status = 'suspended', suspended_reason = 'three_strikes_number_sharing'
         where user_id = NEW.sender_id;

        insert into public.notifications (user_id, type, title, body, meta)
        values (NEW.sender_id, 'suspended', 'توقيف الحساب',
                'تم توقيف الحساب لكسر القواعد',
                jsonb_build_object('reason', 'three_strikes_number_sharing'));
      end if;
    end if;
  end if;

  return NEW;
end;
$$;
revoke all on function public.messages_after_insert() from public, anon, authenticated;
-- trigger already attached in 20260630_internal_chat.sql; create-or-replace keeps it.

-- ── 5. Server-side ENFORCEMENT of suspension (RESTRICTIVE, defence-in-depth) ──
-- products/orders already have several PERMISSIVE policies (incl. an ALL policy
-- and a demo_insert(true)); permissive policies are OR-ed, so the only reliable
-- block is a RESTRICTIVE policy (AND-ed with everything else).
-- A suspended vendor cannot publish (insert/update) products …
drop policy if exists products_block_suspended_ins on public.products;
create policy products_block_suspended_ins on public.products as restrictive for insert
  with check (not public.is_suspended(auth.uid()));
drop policy if exists products_block_suspended_upd on public.products;
create policy products_block_suspended_upd on public.products as restrictive for update
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

-- … and cannot receive new orders (an order for a suspended seller is rejected).
drop policy if exists orders_block_suspended_seller on public.orders;
create policy orders_block_suspended_seller on public.orders as restrictive for insert
  with check (not public.is_suspended(seller_vendor_id));

-- ── 6. Admin re-activation (clears the strike state) ────────────────────────
-- Admins can also just update profiles directly (profiles_admin_update); this
-- RPC is the single authoritative action used by the dashboard button.
create or replace function public.admin_reactivate_account(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.profiles
     set status = 'active', warning_count = 0,
         suspended_reason = null, last_warned_at = null
   where user_id = p_user;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_reactivate_account(uuid) from public, anon;
grant execute on function public.admin_reactivate_account(uuid) to authenticated;

-- ── 7. Identity in chats (14.2): first name + category to participants ──────
-- profiles RLS is self/admin-only, so participants can't read each other's name
-- directly. These SECURITY DEFINER helpers reveal ONLY first name + role, and
-- ONLY to someone who shares a conversation with that person.
create or replace function public.chat_my_conversations()
returns table (
  id uuid, other_id uuid, other_name text, other_role text,
  order_id uuid, last_message_at timestamptz, last_message_preview text, flagged boolean
) language sql stable security definer set search_path = public as $$
  select c.id,
         case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end,
         p.name, p.role,
         c.order_id, c.last_message_at, c.last_message_preview, c.flagged
  from public.conversations c
  left join public.profiles p
    on p.user_id = (case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end)
  where auth.uid() in (c.participant_a, c.participant_b)
  order by c.last_message_at desc;
$$;
revoke all on function public.chat_my_conversations() from public, anon;
grant execute on function public.chat_my_conversations() to authenticated;

create or replace function public.chat_party_name(p_other uuid)
returns table (name text, role text)
language sql stable security definer set search_path = public as $$
  select p.name, p.role
  from public.profiles p
  where p.user_id = p_other
    and exists (
      select 1 from public.conversations c
      where (c.participant_a = auth.uid() and c.participant_b = p_other)
         or (c.participant_b = auth.uid() and c.participant_a = p_other)
    );
$$;
revoke all on function public.chat_party_name(uuid) from public, anon;
grant execute on function public.chat_party_name(uuid) to authenticated;

-- ── 8. Realtime on notifications (instant in-app warnings) ──────────────────
do $$
begin
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
end $$;
