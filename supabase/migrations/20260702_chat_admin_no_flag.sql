-- ============================================================================
-- Lozi — Savings/admin-managed chats: no phone-number warning + client detection
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-02. Idempotent.
--
-- Savings-section chats (قسم التوفير) have LOZI (the platform owner / admin) as
-- the counterpart, so exchanging contact info is legitimate. For these
-- conversations only:
--   1. The BEFORE-INSERT flag trigger skips number/link/email flagging, so no
--      message gets flagged, no admin alert is raised, and no "flagged" note
--      shows. Every other (seller ↔ customer) chat keeps the warning intact.
--   2. chat_party_name / chat_my_conversations expose whether the counterpart is
--      an admin, so the client can suppress the live "sharing numbers" hint.
-- ============================================================================

-- 1. Flag detection: skip entirely when a participant is an admin.
create or replace function public.messages_flag_detect()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reasons       text[];
  v_is_admin_conv boolean;
begin
  select exists (
    select 1
    from public.conversations c
    join public.admins a on a.user_id in (c.participant_a, c.participant_b)
    where c.id = NEW.conversation_id
  ) into v_is_admin_conv;

  if v_is_admin_conv then
    NEW.flag_reasons := '{}';
    NEW.flagged      := false;
  else
    v_reasons        := public.detect_chat_flags(NEW.body, NEW.attachments);
    NEW.flag_reasons := v_reasons;
    NEW.flagged      := coalesce(array_length(v_reasons, 1), 0) > 0;
  end if;
  if NEW.status is null then NEW.status := 'sent'; end if;
  return NEW;
end;
$$;

-- 2a. chat_party_name — add is_admin of the counterpart (adds a column).
drop function if exists public.chat_party_name(uuid);
create function public.chat_party_name(p_other uuid)
returns table(name text, role text, is_admin boolean)
language sql stable security definer set search_path = public as $$
  select p.name, p.role,
         exists(select 1 from public.admins a where a.user_id = p_other) as is_admin
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

-- 2b. chat_my_conversations — add other_is_admin per row (adds a column).
drop function if exists public.chat_my_conversations();
create function public.chat_my_conversations()
returns table(id uuid, other_id uuid, other_name text, other_role text,
              order_id uuid, last_message_at timestamptz, last_message_preview text,
              flagged boolean, other_is_admin boolean)
language sql stable security definer set search_path = public as $$
  select c.id,
         case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end,
         p.name, p.role,
         c.order_id, c.last_message_at, c.last_message_preview, c.flagged,
         exists(select 1 from public.admins a
                 where a.user_id = (case when c.participant_a = auth.uid()
                                         then c.participant_b else c.participant_a end)) as other_is_admin
  from public.conversations c
  left join public.profiles p
    on p.user_id = (case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end)
  where auth.uid() in (c.participant_a, c.participant_b)
  order by c.last_message_at desc;
$$;
revoke all on function public.chat_my_conversations() from public, anon;
grant execute on function public.chat_my_conversations() to authenticated;
