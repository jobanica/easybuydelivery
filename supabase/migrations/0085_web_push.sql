-- Web push, so a rider learns about a cancellation with the app shut.
--
-- The push plumbing in this project has never worked. notify-riders posts to
-- fcm.googleapis.com/fcm/send — the legacy FCM endpoint Google decommissioned
-- in June 2024 — and nothing in the repository ever called it anyway. And the
-- registration hook only runs under Capacitor, so a rider using the web app
-- registered no device at all. Three dead ends meeting in the middle.
--
-- Web push needs no Firebase project and no server key: a VAPID key pair we
-- hold ourselves is the whole of the credential. What it does need is a
-- subscription, which is not one opaque token but an endpoint plus two keys the
-- browser generates, so the payload can be encrypted to that device alone.
--
-- Those two keys hang off the existing table rather than starting a new one:
-- it already has the rider link, the RLS policy, and the account-deletion
-- cleanup, and a subscription is a device by another name. `token` holds the
-- endpoint URL for a web subscription, which is the thing that identifies it.

alter table rider_push_tokens
  add column if not exists p256dh text,
  add column if not exists auth   text;

comment on column rider_push_tokens.p256dh is
  'Web push only: the subscription''s public key, used to encrypt the payload to this device.';
comment on column rider_push_tokens.auth is
  'Web push only: the subscription''s auth secret.';
comment on column rider_push_tokens.token is
  'FCM/APNs device token, or — when platform is ''web'' — the push endpoint URL.';

-- A web subscription is only usable with both halves; a native token with
-- neither. Anything else is a half-saved row that will fail at send time, and
-- failing there is silent.
alter table rider_push_tokens drop constraint if exists rider_push_tokens_web_keys;
alter table rider_push_tokens
  add constraint rider_push_tokens_web_keys check (
    (platform = 'web'  and p256dh is not null and auth is not null)
    or (platform <> 'web' and p256dh is null and auth is null)
  );

-- The endpoint can be long; the unique index on (rider_id, token) would
-- otherwise risk the btree row-size limit on some providers.
create index if not exists rider_push_tokens_platform_idx
  on rider_push_tokens (platform);

/*
 * Who should hear about an order, and how to reach them.
 *
 * Definer, because the send runs as the rider's own session when the operator
 * cancels — that session can see neither other riders' devices nor, for a new
 * pool order, which riders exist. The audience rules live here rather than in
 * the Edge Function so that the one question that matters — who is allowed to
 * be told about this order — is answered in the database.
 */
create or replace function push_audience(p_order_id uuid, p_kind text)
returns table (rider_id uuid, platform text, token text, p256dh text, auth text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o orders%rowtype;
begin
  select * into o from orders where id = p_order_id;
  if not found then return; end if;

  if p_kind = 'cancelled' then
    -- Exactly one person needs this: whoever was carrying it. A cancellation
    -- is not news to anybody else, and the rider holding the goods is the
    -- whole reason this exists.
    if o.rider_id is null then return; end if;
    if not (is_staff() or o.rider_id = current_rider_id()) then
      raise exception 'not allowed';
    end if;
    return query
      select t.rider_id, t.platform, t.token, t.p256dh, t.auth
        from rider_push_tokens t
       where t.rider_id = o.rider_id;

  elsif p_kind = 'new_order' then
    -- The pool. Only riders who could actually take it: approved, not
    -- suspended, not locked out, and online. Waking someone who is off shift
    -- teaches them to turn notifications off.
    if not (is_staff() or o.customer_id = current_customer_id()) then
      raise exception 'not allowed';
    end if;
    if o.status <> 'pending' or o.rider_id is not null then return; end if;
    return query
      select t.rider_id, t.platform, t.token, t.p256dh, t.auth
        from rider_push_tokens t
        join riders r on r.id = t.rider_id
       where r.application_status = 'approved'
         and r.is_suspended = false
         and r.is_locked = false
         and r.is_online = true;

  else
    raise exception 'unknown notification kind: %', p_kind;
  end if;
end;
$$;

revoke all on function push_audience(uuid, text) from public;
grant execute on function push_audience(uuid, text) to authenticated;

/*
 * Drop a subscription the push service has rejected.
 *
 * A browser that has been cleared, reinstalled, or had notifications revoked
 * leaves an endpoint that returns 404 or 410 forever. Left in place they are
 * send attempts that can never succeed, and they make every future push slower
 * and noisier. The Edge Function calls this when a push service says gone.
 */
create or replace function forget_push_endpoint(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from rider_push_tokens where token = p_token;
$$;

revoke all on function forget_push_endpoint(text) from public;
grant execute on function forget_push_endpoint(text) to authenticated;
