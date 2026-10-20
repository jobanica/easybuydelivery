-- Four functions nobody was supposed to be able to call, and everybody could.
--
-- `revoke all on function ... from public` does not do what it reads like on a
-- Supabase database. Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE
-- on every new function in `public` to anon, authenticated and service_role
-- individually. Revoking PUBLIC's grant leaves those three explicit grants
-- standing, so a function "revoked from public" is still callable by anyone
-- holding the anon key — which is in the customer bundle, on purpose.
--
-- Worse, the guard inside set_order_route_km was written as
--
--     if current_user in ('anon', 'authenticated') then raise exception ...
--
-- and in a SECURITY DEFINER function current_user is the *owner*, postgres. The
-- guard could not fire. Both halves of the lock were missing at once, and the
-- function sets delivery fees: anyone could have re-priced any unfinished order
-- to anything between ₱50 and ₱2,030 by asking for a distance.
--
-- post_order_system_message was the same kind of open door pointed somewhere
-- else — it writes a message into an order's chat attributed to 'admin' or
-- 'rider'. A stranger with the anon key could have told a real customer, in the
-- operator's voice, in the thread they were already watching, that their order
-- was cancelled and to send money somewhere. Nothing is known to have used any
-- of this; it was reachable, which is enough.
--
-- The two recalc_* functions only ever recompute a total from rows that are
-- already there, so reaching them bought nothing. They are closed anyway,
-- because "harmless to call" is a property of today's body.
--
-- Found by testing the refusal rather than the success. Here, the permission is
-- the lock; the check inside is the second one.

-- ---------------------------------------------------------------------------
-- The lock: take back what the default privileges handed out
-- ---------------------------------------------------------------------------

revoke execute on function set_order_route_km(uuid, numeric) from anon, authenticated;
revoke execute on function post_order_system_message(uuid, text, text) from anon, authenticated;
revoke execute on function recalc_order_commission(uuid) from anon, authenticated;
revoke execute on function recalc_order_goods(uuid) from anon, authenticated;

-- Each of these is only ever called from inside another SECURITY DEFINER
-- function, where the effective user is the owner rather than the session, so
-- closing the door on client sessions does not close it on the callers that
-- need it. The Edge Function that measures a road holds the service role.

-- ---------------------------------------------------------------------------
-- The second lock: a check that can see who is actually asking
-- ---------------------------------------------------------------------------

/**
 * The role behind this request, as PostgREST set it from the verified JWT.
 *
 * Null when there is no request at all — a migration, psql, a trigger firing
 * during a restore. Deliberately not current_user, which inside a SECURITY
 * DEFINER function is the function's owner and tells you nothing about the
 * caller. Deliberately not session_user either: every PostgREST request
 * authenticates as `authenticator` whatever key it carried, so that cannot
 * tell a rider's session from the service role.
 *
 * A client cannot lie here. PostgREST writes these settings itself, from a
 * signature it has already checked.
 */
create or replace function request_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  begin
    v := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then
    v := null; -- not JSON, or no setting at all
  end;
  if v is null or v = '' then
    v := nullif(current_setting('request.jwt.claim.role', true), '');
  end if;
  return v;
end;
$$;

comment on function request_role() is
  'The role on the caller''s verified JWT, or null outside a PostgREST request. Use this, not current_user, to gate a SECURITY DEFINER function.';

/**
 * Record the measured road distance and re-price the order from it.
 *
 * Unchanged except for the guard, which now reads the request instead of
 * current_user and so refuses the sessions it was always meant to refuse. The
 * number this carries is the number a rider gets paid, which is exactly why a
 * rider's app may not be the thing that sends it.
 */
create or replace function set_order_route_km(p_order_id uuid, p_km numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o         orders%rowtype;
  v_role    text;
  v_new_fee numeric;
begin
  v_role := request_role();
  -- No request context means SQL run by hand or by a migration, which is
  -- already privileged. A request carrying anything but the service role is a
  -- browser, and a browser does not get to set a fee.
  if v_role is not null and v_role <> 'service_role' then
    raise exception 'not allowed';
  end if;
  if p_km is null or p_km < 0 or p_km > 200 then
    raise exception 'implausible route distance: % km', p_km;
  end if;

  select * into o from orders where id = p_order_id;
  if not found then raise exception 'no such order'; end if;
  if o.status in ('delivered', 'cancelled') then
    return jsonb_build_object('updated', false, 'reason', 'finished');
  end if;

  v_new_fee := fee_for_km(p_km);

  update orders
     set route_km = p_km,
         delivery_fee = v_new_fee
   where id = p_order_id;

  perform recalc_order_commission(p_order_id);

  return jsonb_build_object(
    'updated', true,
    'km', p_km,
    'old_fee', o.delivery_fee,
    'new_fee', v_new_fee
  );
end;
$$;

revoke all on function set_order_route_km(uuid, numeric) from public;
revoke execute on function set_order_route_km(uuid, numeric) from anon, authenticated;
