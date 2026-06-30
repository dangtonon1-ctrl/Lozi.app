-- ============================================================================
-- Lozi — Realtime internal chat with admin oversight + number-leak detection
-- (نظام دردشة داخلي لحظي مع رقابة الإدارة)
-- Applied to project niloddwnllhsvrmuxfxw on 2026-06-30. Idempotent.
--
-- GOAL: let any two parties (customer↔store, store↔store, store↔farmer, …)
--       message each other INSIDE the app, 1:1 only, optionally tied to an order.
-- POLICY: sharing phone numbers / external contacts is forbidden (keeps business
--         inside the app). Messages still SEND; suspicious ones are FLAGGED to
--         draw admin attention (no hard block at this stage).
-- OVERSIGHT: the admin can READ ALL conversations (full monitoring); the auto
--            flag layer only highlights high-risk chats on top of that.
--
-- Identity model: a "user id" here is auth.uid() == profiles.user_id.
--   A store's id is stores.vendor_id, which equals the seller's profiles.user_id
--   (same value used by orders.seller_vendor_id). So conversations.participant_*
--   always reference a profiles.user_id.
-- ============================================================================

-- ── 1. Conversations (1:1, optional order link) ─────────────────────────────
-- participant_a/participant_b are stored CANONICALLY (a < b) so a pair maps to a
-- single row; find_or_create_conversation() guarantees the ordering.
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  participant_a   uuid not null,                 -- canonical: always the lesser uuid
  participant_b   uuid not null,                 -- canonical: always the greater uuid
  order_id        uuid references public.orders(id) on delete set null,  -- optional order-linked thread
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  -- Flag rollup: true if ANY message in the thread was auto-flagged. Lets the
  -- admin sort high-risk chats to the top without scanning every message.
  flagged         boolean not null default false,
  flagged_count   integer not null default 0,
  check (participant_a < participant_b)
);

-- One conversation per pair per order context (NULL order => the general thread).
create unique index if not exists conversations_pair_order_uniq
  on public.conversations (participant_a, participant_b,
                           coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists conversations_a_idx        on public.conversations (participant_a);
create index if not exists conversations_b_idx        on public.conversations (participant_b);
create index if not exists conversations_order_idx    on public.conversations (order_id);
create index if not exists conversations_activity_idx on public.conversations (last_message_at desc);
create index if not exists conversations_flagged_idx  on public.conversations (flagged) where flagged;

-- ── 2. Messages (text only now; attachments concept ready for IMAGES later) ──
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null,
  body            text,                          -- nullable so an attachment-only msg is possible later
  -- EXTENSION POINT (images later, NO rebuild): each attachment will be e.g.
  --   { "type":"image", "path":"chat/<id>.jpg", "w":..,"h":.. }. OCR number-scan
  --   will run over these in detect_chat_flags() — see the TODO there. Nothing is
  --   uploaded or scanned now; the column simply exists so the schema is ready.
  attachments     jsonb  not null default '[]'::jsonb,
  flagged         boolean not null default false,           -- set by trigger, server-authoritative
  flag_reasons    text[]  not null default '{}',            -- e.g. {number,whatsapp,telegram,email}
  status          text    not null default 'sent' check (status in ('sent','delivered','read')),
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_time_idx on public.messages (conversation_id, created_at);
create index if not exists messages_flagged_idx   on public.messages (flagged) where flagged;
-- Realtime UPDATE/DELETE payloads need the full old row (e.g. read receipts).
alter table public.messages replica identity full;

-- ── 3. Admin alert table (the extra ALERT layer on top of full monitoring) ──
-- A flagged message raises one alert row with the conversation context so the
-- admin notices high-risk chats first. Visible to admins only.
create table if not exists public.chat_flag_alerts (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete cascade,
  sender_id       uuid,
  reasons         text[] not null default '{}',
  created_at      timestamptz not null default now(),
  seen            boolean not null default false,    -- admin opened it
  resolved        boolean not null default false     -- admin handled it (penalty is manual, separate)
);
create index if not exists chat_flag_alerts_open_idx on public.chat_flag_alerts (created_at desc)
  where resolved = false;

-- ── 4. Text normalization (defeats split-digit / mixed-script evasion) ───────
-- People evade by splitting digits (٧٧٧ ٥٥٥), mixing Arabic/Latin, or adding
-- symbols. Normalize FIRST, then match. This collapses to Latin digits only.
create or replace function public.chat_normalize_digits(p text)
returns text language sql immutable set search_path = public as $$
  -- Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) → Latin, then keep digits.
  select regexp_replace(
           translate(coalesce(p, ''),
             '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
             '01234567890123456789'),
           '[^0-9]', '', 'g');
$$;

-- ── 5. Detection: returns the list of matched reasons (empty = clean) ────────
-- Rule: after normalization, flag a 9-digit Yemeni mobile starting 77/73/71/78.
-- Also flag WhatsApp/Telegram links and email addresses (same flag, for the
-- admin's attention). This is an ALERT aid — it never blocks the send.
create or replace function public.detect_chat_flags(p_body text, p_attachments jsonb default '[]'::jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare
  v_digits  text;
  v_low     text;   -- lowercased, Arabic digits → Latin, structure kept (for links/email)
  v_nospace text;   -- v_low with spaces removed (defeats "w a . m e" style splitting)
  v_reasons text[] := '{}';
begin
  if p_body is null or length(trim(p_body)) = 0 then return v_reasons; end if;

  -- (1) NUMBER LEAK: digits-only normalization, then Yemeni mobile pattern.
  --     7[7318]\d{7} == 9 digits starting with 77, 73, 71 or 78.
  v_digits := public.chat_normalize_digits(p_body);
  if v_digits ~ '7[7318][0-9]{7}' then
    v_reasons := array_append(v_reasons, 'number');
  end if;

  -- (2) LINKS / EMAIL: lighter normalization that keeps @ . / : and letters.
  v_low     := lower(translate(p_body, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
  v_nospace := replace(v_low, ' ', '');

  if v_nospace ~ '(wa\.me|whatsapp|chat\.whatsapp|api\.whatsapp|واتساب|واتس)' then
    v_reasons := array_append(v_reasons, 'whatsapp');
  end if;
  if v_nospace ~ '(t\.me|telegram|tg://|تلغرام|تليجرام|تيليجرام|تيليغرام)' then
    v_reasons := array_append(v_reasons, 'telegram');
  end if;
  if v_low ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    v_reasons := array_append(v_reasons, 'email');
  end if;

  -- TODO(images/OCR): when attachments carry images, run OCR here over
  --   p_attachments and feed the recognized text back through the same number
  --   normalization + pattern above. No signature change needed — the param is
  --   already in place. Not implemented now (text only).

  return v_reasons;
end;
$$;

-- ── 6. CENTRAL permission rule (open now, restrictable later, NO refactor) ───
-- This is the SINGLE place that decides whether one party may message another.
-- For now it is OPEN: any user category may message any other category.
--
-- CONFIG POINT / TODO(perms): to tighten later (e.g. restrict which categories
--   may INITIATE), do it HERE only — callers (find_or_create_conversation, the
--   message INSERT policy) never change. Roles are already fetched below so a
--   future category matrix can be dropped in. A global kill-switch is also wired
--   to settings(key='chat_disabled'); set its value to 'true' to disable chat
--   app-wide without code changes.
create or replace function public.chat_can_message(p_from uuid, p_to uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_from_role text;
  v_to_role   text;
  v_disabled  text;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return false;
  end if;

  -- Optional global kill-switch (config point). Guarded so a missing/odd row
  -- never breaks messaging.
  begin
    select value into v_disabled from public.settings where key = 'chat_disabled';
    if v_disabled is not null and lower(v_disabled) in ('true', '"true"', '1') then
      return false;
    end if;
  exception when others then
    null;  -- settings is optional here
  end;

  -- Roles available for a FUTURE category matrix (unused while policy is open).
  select role into v_from_role from public.profiles where user_id = p_from;
  select role into v_to_role   from public.profiles where user_id = p_to;
  -- TODO(perms): e.g.  if v_from_role = 'customer' and v_to_role = 'customer'
  --                       then return false;  -- (example future restriction)

  return true;  -- OPEN for now.
end;
$$;
revoke all on function public.chat_can_message(uuid, uuid) from public, anon;
grant execute on function public.chat_can_message(uuid, uuid) to authenticated;

-- ── 7. Start/attach a conversation (centralizes the permission check) ────────
-- Client calls this RPC instead of inserting directly, so the canonical pairing
-- and the permission rule live in one place. p_order optionally ties the thread
-- to a specific order so buyer & seller can discuss it.
create or replace function public.find_or_create_conversation(p_other uuid, p_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_a  uuid;
  v_b  uuid;
  v_id uuid;
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.chat_can_message(v_me, p_other) then
    raise exception 'messaging not allowed for this pair';
  end if;

  if v_me < p_other then v_a := v_me; v_b := p_other;
  else                   v_a := p_other; v_b := v_me; end if;

  select id into v_id from public.conversations
   where participant_a = v_a and participant_b = v_b
     and coalesce(order_id, v_sentinel) = coalesce(p_order, v_sentinel)
   limit 1;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.conversations (participant_a, participant_b, order_id)
    values (v_a, v_b, p_order)
    returning id into v_id;
  exception when unique_violation then
    -- Concurrent create: fetch the row the other transaction inserted.
    select id into v_id from public.conversations
     where participant_a = v_a and participant_b = v_b
       and coalesce(order_id, v_sentinel) = coalesce(p_order, v_sentinel)
     limit 1;
  end;
  return v_id;
end;
$$;
revoke all on function public.find_or_create_conversation(uuid, uuid) from public, anon;
grant execute on function public.find_or_create_conversation(uuid, uuid) to authenticated;

-- ── 8. Triggers: detect on insert, roll up + alert after insert ─────────────
-- BEFORE INSERT: server is the source of truth for flagged/flag_reasons, so a
-- client can never bypass detection by sending flagged=false.
create or replace function public.messages_flag_detect()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reasons text[];
begin
  v_reasons        := public.detect_chat_flags(NEW.body, NEW.attachments);
  NEW.flag_reasons := v_reasons;
  NEW.flagged      := coalesce(array_length(v_reasons, 1), 0) > 0;
  if NEW.status is null then NEW.status := 'sent'; end if;
  return NEW;
end;
$$;
revoke all on function public.messages_flag_detect() from public, anon, authenticated;
drop trigger if exists trg_messages_flag_detect on public.messages;
create trigger trg_messages_flag_detect before insert on public.messages
  for each row execute function public.messages_flag_detect();

-- AFTER INSERT: keep the conversation's activity/preview/flag rollup current and
-- raise an admin alert (with conversation context) when a message is flagged.
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at      = NEW.created_at,
         last_message_preview = left(coalesce(NEW.body, ''), 140),
         flagged       = flagged or NEW.flagged,
         flagged_count = flagged_count + (case when NEW.flagged then 1 else 0 end)
   where id = NEW.conversation_id;

  if NEW.flagged then
    insert into public.chat_flag_alerts (conversation_id, message_id, sender_id, reasons)
    values (NEW.conversation_id, NEW.id, NEW.sender_id, NEW.flag_reasons);
  end if;
  return NEW;
end;
$$;
revoke all on function public.messages_after_insert() from public, anon, authenticated;
drop trigger if exists trg_messages_after_insert on public.messages;
create trigger trg_messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- BEFORE UPDATE protection: a participant may only change `status` (read
-- receipts). Body/attachments/flag fields are immutable to non-admins, so the
-- detection result can't be tampered with. Admins may edit freely (oversight).
create or replace function public.messages_protect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return NEW; end if;
  NEW.body            := OLD.body;
  NEW.attachments     := OLD.attachments;
  NEW.flagged         := OLD.flagged;
  NEW.flag_reasons    := OLD.flag_reasons;
  NEW.sender_id       := OLD.sender_id;
  NEW.conversation_id := OLD.conversation_id;
  NEW.created_at      := OLD.created_at;
  return NEW;
end;
$$;
revoke all on function public.messages_protect() from public, anon, authenticated;
drop trigger if exists trg_messages_protect on public.messages;
create trigger trg_messages_protect before update on public.messages
  for each row execute function public.messages_protect();

-- ── 9. Row Level Security ────────────────────────────────────────────────────
-- Participants read/write THEIR OWN conversation; the ADMIN role reads ALL
-- (full oversight) and is the only one who can flag/penalize. Vendors/customers
-- can never read others' chats.
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.chat_flag_alerts enable row level security;

-- conversations: participant or admin may read.
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select
  using (auth.uid() in (participant_a, participant_b) or public.is_admin());

-- Direct insert is allowed only for a participant of the (canonical) pair who is
-- permitted to message. Normal clients go through find_or_create_conversation();
-- this policy is the backstop/escape hatch and keeps the rule centralized.
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations for insert
  with check (
    auth.uid() in (participant_a, participant_b)
    and participant_a < participant_b
    and public.chat_can_message(participant_a, participant_b)
  );

-- Only admins may directly UPDATE/DELETE a conversation row. The activity/flag
-- rollup is maintained by the SECURITY DEFINER trigger above, not by users.
drop policy if exists conversations_admin_write on public.conversations;
create policy conversations_admin_write on public.conversations for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists conversations_admin_delete on public.conversations;
create policy conversations_admin_delete on public.conversations for delete
  using (public.is_admin());

-- messages: read if admin or a participant of the parent conversation.
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );

-- write: a participant may post AS THEMSELVES into their own conversation.
-- (flagged/flag_reasons are overwritten by the trigger regardless of input.)
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );

-- update: participant (own conversation, status only — enforced by trigger) or
-- admin (full). delete: admin only.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and auth.uid() in (c.participant_a, c.participant_b)
    )
  );
drop policy if exists messages_admin_delete on public.messages;
create policy messages_admin_delete on public.messages for delete
  using (public.is_admin());

-- chat_flag_alerts: admin only (read + manage). Inserts come from the trigger
-- (SECURITY DEFINER), so no insert policy is granted to users.
drop policy if exists chat_flag_alerts_admin_read on public.chat_flag_alerts;
create policy chat_flag_alerts_admin_read on public.chat_flag_alerts for select
  using (public.is_admin());
drop policy if exists chat_flag_alerts_admin_update on public.chat_flag_alerts;
create policy chat_flag_alerts_admin_update on public.chat_flag_alerts for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists chat_flag_alerts_admin_delete on public.chat_flag_alerts;
create policy chat_flag_alerts_admin_delete on public.chat_flag_alerts for delete
  using (public.is_admin());

-- ── 10. Admin oversight view: all conversations + participant names + order ──
-- Used by the admin "الدردشات" tab. security_invoker=true makes the view respect
-- the CALLER's RLS (admins have profiles_admin_read / can read all conversations,
-- so they see everything); the is_admin() gate keeps it admin-only — a non-admin
-- caller gets zero rows. (invoker mode also avoids the SECURITY DEFINER view lint.)
drop view if exists public.admin_conversations;
create view public.admin_conversations
with (security_invoker = true) as
  select c.id, c.participant_a, c.participant_b, c.order_id,
         c.created_at, c.last_message_at, c.last_message_preview,
         c.flagged, c.flagged_count,
         pa.name  as participant_a_name, pa.role as participant_a_role,
         pb.name  as participant_b_name, pb.role as participant_b_role,
         o.order_no as order_no
  from public.conversations c
  left join public.profiles pa on pa.user_id = c.participant_a
  left join public.profiles pb on pb.user_id = c.participant_b
  left join public.orders   o  on o.id       = c.order_id
  where public.is_admin();
grant select on public.admin_conversations to authenticated;

-- ── 11. Realtime: instant delivery on messages (and conversation list moves) ─
do $$
begin
  begin alter publication supabase_realtime add table public.messages;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_flag_alerts; exception when duplicate_object then null; end;
end $$;
