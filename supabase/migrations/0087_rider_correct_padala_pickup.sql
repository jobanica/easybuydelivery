-- The rider fixes where a Padala parcel is actually collected from.
--
-- 0068 let a rider move the drop-off and re-priced the run; 0073 did the same
-- for the first Pabili shop. Padala was left with neither: its pickup is a bare
-- pin on the order, with no store row and no buy_stores entry, so none of the
-- existing controls reached it. A sender pinning a collection point from memory
-- gets it wrong exactly as often as anyone else, and the rider is the one who
-- finds out — in the wrong street, with nothing they can do about it.
--
-- The fee has to follow. Under per-km pricing the delivery fee is the distance
-- from the pickup to the door, so a pickup two kilometres from where the parcel
-- really is means the rider rides those kilometres unpaid. That is the point of
-- this, and it is why the re-quote happens here rather than in the rider's app:
-- the number a rider collects is not a number a rider gets to type.

create or replace function rider_correct_pickup_pin(
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_address text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider   uuid := current_rider_id();
  o         orders%rowtype;
  v_moved   double precision;
  v_new_fee numeric;
  v_lat     double precision;
  v_lng     double precision;
  v_radius  numeric;
  v_km      double precision;
  v_msg     text;
begin
  if v_rider is null then raise exception 'not a rider'; end if;
  if p_lat is null or p_lng is null then raise exception 'A location is required.'; end if;

  select * into o from orders
   where id = p_order_id and rider_id = v_rider;
  if not found then
    raise exception 'You can only change a delivery you are handling.';
  end if;
  if o.status in ('delivered', 'cancelled') then
    raise exception 'This delivery is finished, so the pin can no longer be changed.'
      using errcode = 'check_violation';
  end if;

  -- Pabili already has a control for this, attached to the shop it belongs to,
  -- and Food measures from the restaurant's own pin rather than the order's.
  -- Two ways to move the same pin is how they drift apart.
  if o.service_type <> 'padala' then
    raise exception 'Only a Padala pickup is moved here.'
      using errcode = 'check_violation';
  end if;

  -- Bounded by where we actually operate, not by how far the sender's mistake
  -- was: capping the *move* would block the case that needs this most, a pin
  -- dropped in the wrong town entirely.
  select service_center_lat, service_center_lng, service_radius_km
    into v_lat, v_lng, v_radius
    from app_settings limit 1;
  if v_lat is not null and v_lng is not null and coalesce(v_radius, 0) > 0 then
    v_km := km_between(v_lat, v_lng, p_lat, p_lng);
    if v_km > v_radius then
      return jsonb_build_object('updated', false, 'reason', 'outside_area',
        'message', format('That spot is about %s km out, past our %s km service area. Call the sender and check where the parcel actually is.',
                          round(v_km::numeric, 1), v_radius));
    end if;
  end if;

  if o.pickup_lat is not null and o.pickup_lng is not null then
    v_moved := pin_distance_m(o.pickup_lat, o.pickup_lng, p_lat, p_lng);
    -- A few metres is GPS drift, not a correction worth telling anyone about.
    if v_moved < 20 and p_address is null then
      return jsonb_build_object('updated', false, 'reason', 'unchanged',
        'message', 'That is the same spot the pin is already on.');
    end if;
  end if;

  -- The pin moves first, because the fee is quoted *from* it: order_origin_pins
  -- reads pickup_lat/lng straight off the order, so asking before the write
  -- would re-quote the distance we are in the middle of correcting.
  update orders
     set pickup_lat = p_lat,
         pickup_lng = p_lng,
         pickup_address = coalesce(nullif(btrim(p_address), ''), pickup_address)
   where id = p_order_id;

  v_new_fee := quote_delivery_fee(p_order_id, o.delivery_lat, o.delivery_lng);

  update orders set delivery_fee = v_new_fee where id = p_order_id;

  -- The operator's cut is a share of the delivery fee, so it moves too.
  perform recalc_order_commission(p_order_id);

  insert into order_pin_corrections
    (order_id, rider_id, kind, from_lat, from_lng, to_lat, to_lng, moved_m, old_fee, new_fee)
  values
    (p_order_id, v_rider, 'pickup', o.pickup_lat, o.pickup_lng, p_lat, p_lng,
     v_moved, o.delivery_fee, v_new_fee);

  -- Said in the thread the sender is already watching. A delivery fee that
  -- changes without a word is how a rider gets argued with at the door.
  v_msg := '📍 I''ve moved the pickup pin to where the parcel actually is';
  if v_moved is not null and v_moved >= 1000 then
    v_msg := v_msg || format(' (%s km from the original pin)', round((v_moved / 1000)::numeric, 1));
  elsif v_moved is not null and v_moved >= 20 then
    v_msg := v_msg || format(' (%s m from the original pin)', round(v_moved::numeric));
  end if;
  v_msg := v_msg || '.';
  if o.delivery_fee is distinct from v_new_fee then
    v_msg := v_msg || format(' The delivery fee is now %s (was %s).',
      to_char(v_new_fee, 'FM₱999G999D00'), to_char(o.delivery_fee, 'FM₱999G999D00'));
  end if;
  perform post_order_system_message(p_order_id, 'rider', v_msg);

  return jsonb_build_object(
    'updated', true,
    'moved_m', v_moved,
    'old_fee', o.delivery_fee,
    'new_fee', v_new_fee
  );
end;
$$;

revoke all on function rider_correct_pickup_pin(uuid, double precision, double precision, text) from public;
grant execute on function rider_correct_pickup_pin(uuid, double precision, double precision, text) to authenticated;
