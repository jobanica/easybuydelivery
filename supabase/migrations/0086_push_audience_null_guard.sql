-- A permission check that three-valued logic quietly turned off.
--
-- push_audience guarded itself like this:
--
--   if not (is_staff() or o.rider_id = current_rider_id()) then
--     raise exception 'not allowed';
--   end if;
--
-- For a signed-in stranger, is_staff() is false and current_rider_id() is NULL,
-- so `o.rider_id = current_rider_id()` is NULL rather than false. `false or
-- NULL` is NULL, `not NULL` is NULL, and IF treats NULL as "don't run" — so the
-- raise was skipped and the caller sailed past the check. Any authenticated
-- user who knew an order id could make us push to that order's rider.
--
-- The content was never theirs to choose and the id is a uuid, so this was
-- noise rather than a megaphone. It was still a check that silently did
-- nothing, which is the worst kind, and it was invisible to reading — the code
-- says exactly what it means and means something else.
--
-- The fix is to decide what NULL means instead of letting it decide: a
-- comparison that cannot be evaluated is not permission.

create or replace function push_audience(p_order_id uuid, p_kind text)
returns table (rider_id uuid, platform text, token text, p256dh text, auth text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o       orders%rowtype;
  v_rider uuid := current_rider_id();
  v_cust  uuid := current_customer_id();
begin
  select * into o from orders where id = p_order_id;
  if not found then return; end if;

  if p_kind = 'cancelled' then
    -- Exactly one person needs this: whoever was carrying it. A cancellation
    -- is not news to anybody else, and the rider holding the goods is the
    -- whole reason this exists.
    if o.rider_id is null then return; end if;
    if is_staff() is not true and (v_rider is null or o.rider_id <> v_rider) then
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
    if is_staff() is not true and (v_cust is null or o.customer_id <> v_cust) then
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
