-- 074_notification_mark_read_session.sql
-- ---------------------------------------------------------------------------
-- Persist "notification read" under the session spine.
--
-- mark_notification_read_rpc (011) matched on auth.uid(), which is always
-- NULL in this app — identity comes from the x-session-token/Bearer header
-- since 022 (see the notes in 043).  A student session matched neither leg
-- of the WHERE clause (auth.uid() is NULL and the role is not 'admin'), so
-- the UPDATE touched zero rows.  The notification only *looked* read because
-- the client flips it optimistically; it reverted on the next fetch, and the
-- student dashboard navigates with a full page reload on click, so it came
-- back unread immediately.
--
-- Both RPCs are now keyed on the session identity helpers from 022:
--   * mark_notification_read_rpc     — session user (or admin) may mark one.
--   * mark_all_notifications_read_rpc — previously had no ownership check at
--     all, so any caller could pass another user's id and clear their
--     notifications; it now requires the caller's own session user (or
--     admin).  The client already passes currentUser.id, so nothing changes
--     for legitimate callers.
--
-- Both functions are security definer (RLS is bypassed); the WHERE clause is
-- the only ownership gate, hence the explicit session grounding below.
-- ---------------------------------------------------------------------------

create or replace function public.mark_notification_read_rpc(
  p_notification_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set is_read = true
  where id = p_notification_id
    and (
      user_id = public.current_session_user_id()
      or public.current_app_role() = 'admin'
    );
$$;

create or replace function public.mark_all_notifications_read_rpc(
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set is_read = true
  where user_id = p_user_id
    and is_read = false
    and (
      p_user_id = public.current_session_user_id()
      or public.current_app_role() = 'admin'
    );
$$;
