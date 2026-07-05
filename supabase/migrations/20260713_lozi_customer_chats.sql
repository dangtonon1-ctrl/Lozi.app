-- ============================================================================
-- Lozi — Admin inbox for "تواصل مع لوزي" (Contact Lozi) customer chats.
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-13. Idempotent.
--
-- CONTEXT: the existing admin «المحادثات» tab is READ-ONLY surveillance of every
-- conversation (see admin_conversations view + ChatsAdmin). Separately, customers
-- open a thread with Lozi itself via the "تواصل مع لوزي" button, which calls
-- find_or_create_admin_conversation() — pairing the customer with an admin from
-- public.admins (order_id IS NULL, rfq_offer_id IS NULL). Those threads live in
-- the SAME conversations/messages tables and are NEVER auto-flagged (see
-- 20260702_chat_admin_no_flag.sql), so the admin can legitimately REPLY there.
--
-- This RPC is the dedicated feed for the admin's «دردشات عملاء لوزي» sub-tab:
--   * only admin-routed general threads (a participant is in public.admins),
--   * one row per customer thread, most-recent activity first,
--   * shaped like admin_conversations rows so the existing ChatThread component
--     (which already allows a participant-admin to reply) is reused unchanged,
--   * plus customer_id / admin_id / last_sender_id and an `unanswered` flag
--     (last message came from the customer, not the admin) that drives the
--     unread indicator on the sub-tab.
-- Nothing existing is modified: the admin_conversations view, the surveillance
-- list and the customer-facing chat.js are all untouched.
-- ============================================================================
create or replace function public.admin_lozi_customer_chats()
returns table (
  id                     uuid,
  participant_a          uuid,
  participant_b          uuid,
  order_id               uuid,
  rfq_offer_id           uuid,
  created_at             timestamptz,
  last_message_at        timestamptz,
  last_message_preview   text,
  flagged                boolean,
  flagged_count          integer,
  participant_a_name     text,
  participant_a_role     text,
  participant_b_name     text,
  participant_b_role     text,
  order_no               text,
  customer_id            uuid,
  customer_name          text,
  customer_role          text,
  admin_id               uuid,
  last_sender_id         uuid,
  unanswered             boolean
)
language sql stable security definer set search_path = public as $$
  with admin_convs as (
    select c.id, c.participant_a, c.participant_b, c.order_id, c.rfq_offer_id,
           c.created_at, c.last_message_at, c.last_message_preview,
           c.flagged, c.flagged_count,
           (select a.user_id from public.admins a
             where a.user_id in (c.participant_a, c.participant_b)
             limit 1) as admin_uid
    from public.conversations c
    where exists (select 1 from public.admins a
                   where a.user_id in (c.participant_a, c.participant_b))
      and c.order_id is null        -- Contact-Lozi threads are order-less…
      and c.rfq_offer_id is null     -- …and not pre-order (RFQ) threads.
  ),
  -- Most recent message per thread → who spoke last (drives `unanswered`).
  last_msg as (
    select distinct on (m.conversation_id) m.conversation_id, m.sender_id
    from public.messages m
    where m.conversation_id in (select id from admin_convs)
    order by m.conversation_id, m.created_at desc
  )
  select ac.id, ac.participant_a, ac.participant_b, ac.order_id, ac.rfq_offer_id,
         ac.created_at, ac.last_message_at, ac.last_message_preview,
         ac.flagged, ac.flagged_count,
         pa.name, pa.role, pb.name, pb.role,
         null::text as order_no,
         (case when ac.participant_a = ac.admin_uid
               then ac.participant_b else ac.participant_a end) as customer_id,
         cp.name, cp.role,
         ac.admin_uid as admin_id,
         lm.sender_id as last_sender_id,
         (lm.sender_id is not null and lm.sender_id <> ac.admin_uid) as unanswered
  from admin_convs ac
  left join last_msg lm on lm.conversation_id = ac.id
  left join public.profiles pa on pa.user_id = ac.participant_a
  left join public.profiles pb on pb.user_id = ac.participant_b
  left join public.profiles cp
    on cp.user_id = (case when ac.participant_a = ac.admin_uid
                          then ac.participant_b else ac.participant_a end)
  where public.is_admin()
  order by ac.last_message_at desc;
$$;
revoke all on function public.admin_lozi_customer_chats() from public, anon;
grant execute on function public.admin_lozi_customer_chats() to authenticated;
