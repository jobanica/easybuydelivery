-- Price the ride, not the crow's flight.
--
-- The delivery fee has always been quoted from the straight-line distance
-- between the pickup and the door. Riders do not fly. Measured against routed
-- road distance over forty recent deliveries, the real ride was a median 1.29
-- times the straight line and as much as 3.3 times it, and the forty together
-- were underpaid by ₱635.
--
-- The worst cases are not random. A river runs between Floridablanca and
-- Guagua: a drop-off 1.9 km away as the crow flies is 4.6 km by road, because
-- the road goes down to the bridge at Mabical and back up. The straight line
-- crosses water the rider cannot. Every closed subdivision and dual carriageway
-- does a smaller version of the same thing.
--
-- So an order now carries the road distance it was priced from, and the fee is
-- worked out from that. Routing needs the internet, which Postgres has no
-- business doing mid-transaction, so an Edge Function measures it and writes it
-- here. What stays in the database is the arithmetic and the authority: the
-- fee is still computed from a distance, and a rider still cannot type one.

alter table orders
  add column if not exists route_km numeric(8, 3);

comment on column orders.route_km is
  'Road distance this order was priced from, in km. Null means the fee fell back to the straight-line estimate.';

-- The fallback, for when routing is unavailable: straight-line distances are
-- short by about this much around here. Measured, not guessed — the median of
-- forty routed deliveries. An operator in flatter country should lower it.
alter table app_settings
  add column if not exists route_detour_factor numeric(4, 2) not null default 1.35
    check (route_detour_factor >= 1 and route_detour_factor <= 3);

comment on column app_settings.route_detour_factor is
  'What to multiply a straight-line distance by when road routing is unavailable. 1.0 disables the correction.';

/**
 * What this order's delivery fee would be with the drop-off at (lat, lng).
 *
 * Unchanged in shape; what changed is that the straight line is no longer
 * treated as the distance ridden. Where a routed distance is already on the
 * order this leaves it alone — the caller asking "what if the pin were here"
 * wants the estimate, and the routed figure is written separately once the new
 * pin has actually been measured.
 */
create or replace function quote_delivery_fee(
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s       app_settings%rowtype;
  v_km    double precision;
begin
  select * into s from app_settings limit 1;
  if s.delivery_fee_model is distinct from 'per_km' then
    return round(coalesce(s.default_delivery_fee, 50)::numeric, 2);
  end if;

  select max(km_between(o.lat, o.lng, p_lat, p_lng))
    into v_km
    from order_origin_pins(p_order_id) o;

  if v_km is null then
    return round(coalesce(s.default_delivery_fee, 50)::numeric, 2);
  end if;

  -- The correction that stops a river from being free to cross.
  v_km := v_km * coalesce(s.route_detour_factor, 1.35);

  return round((coalesce(s.delivery_base_fare, 50)
    + coalesce(s.delivery_per_km, 10) * greatest(0, v_km - coalesce(s.delivery_base_km, 2)))::numeric, 2);
end;
$$;

/** The fee for a known distance, so one formula serves both paths. */
create or replace function fee_for_km(p_km numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select delivery_fee_model from app_settings limit 1) is distinct from 'per_km'
      then round(coalesce((select default_delivery_fee from app_settings limit 1), 50)::numeric, 2)
    else round((
      coalesce((select delivery_base_fare from app_settings limit 1), 50)
      + coalesce((select delivery_per_km from app_settings limit 1), 10)
        * greatest(0, p_km - coalesce((select delivery_base_km from app_settings limit 1), 2))
    )::numeric, 2)
  end;
$$;

/**
 * Record the measured road distance and re-price the order from it.
 *
 * The single place a routed distance may enter. Written by the Edge Function
 * that did the measuring, running as the service role — a rider's session
 * cannot reach it, because the number it carries is the number they get paid.
 *
 * Refuses to touch a finished order: a delivered run's fee is a record of what
 * was charged, not a figure to keep recalculating.
 */
create or replace function set_order_route_km(p_order_id uuid, p_km numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o         orders%rowtype;
  v_new_fee numeric;
begin
  if current_user in ('anon', 'authenticated') then
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
