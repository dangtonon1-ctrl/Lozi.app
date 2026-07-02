-- ============================================================================
-- Lozi — Start/attach a conversation with the Lozi administration.
-- Applied to project niloddwnllhsvrmuxfxw on 2026-07-02. Idempotent.
--
-- The Savings section (قسم التوفير) is run by Lozi directly, so its chat button
-- must open a thread with an admin rather than a store vendor. This RPC mirrors
-- find_or_create_conversation() but resolves the counterpart to an admin from
-- public.admins, so the client never needs to know an admin's user id. It reuses
-- the exact same conversations table / RLS / realtime pipeline (no new chat
-- system) — the admin oversight tools already read every conversation.
-- ============================================================================
create or replace function public.find_or_create_admin_conversation()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_admin    uuid;
  v_a        uuid;
  v_b        uuid;
  v_id       uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- Pick a stable admin that is not the caller (lowest user id wins).
  select user_id into v_admin
    from public.admins
   where user_id <> v_me
   order by user_id
   limit 1;
  if v_admin is null then raise exception 'no admin available'; end if;

  -- Canonical ordering (participant_a < participant_b), general (order-less) thread.
  if v_me < v_admin then v_a := v_me; v_b := v_admin;
  else                   v_a := v_admin; v_b := v_me; end if;

  select id into v_id from public.conversations
   where participant_a = v_a and participant_b = v_b and order_id is null
   limit 1;
  if v_id is not null then return v_id; end if;

  begin
    insert into public.conversations (participant_a, participant_b, order_id)
    values (v_a, v_b, null)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.conversations
     where participant_a = v_a and participant_b = v_b and order_id is null
     limit 1;
  end;
  return v_id;
end;
$$;
revoke all on function public.find_or_create_admin_conversation() from public, anon;
grant execute on function public.find_or_create_admin_conversation() to authenticated;
