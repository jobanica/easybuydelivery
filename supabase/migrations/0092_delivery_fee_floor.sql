-- A fee the customer's browser could not work out is not ₱50.
--
-- Under per-km pricing the delivery fee is quoted in the browser and sent with
-- the order, and the database has always taken that number on trust. That is
-- fine while the browser can see what it needs to. When it cannot, resolve-
-- DeliveryFee falls back to the flat fee — and the flat fee here is ₱50, which
-- is also the base fare, so an order that could not be priced at all is
-- indistinguishable from a short one that was.
--
-- It happened. One order in the forty since road pricing went live went out at
-- ₱50 for a 3.07 km ride that should have been ₱86.40. The shop was pinned and
-- the door was pinned; what was missing was the pin *in that tab*, which had
-- been open since before the shop was put on the map — the shop list is
-- fetched once when the app starts and never again. No origin meant no routing
-- request, no straight line either, and a silent drop to the flat fee.
--
-- The browser now asks the server for the distance by shop id, so that
-- particular hole is closed. This is the floor under all of them: whatever the
-- browser believed, an order priced by distance is worth at least what the
-- database can work out from the pins it holds itself. A client that cannot
-- measure can ask for less than the real fee, and no longer be given it.

/**
 * Raise an order's delivery fee to what the pins say it is worth.
 *
 * Only ever raises. A browser that quoted *more* than this — because the real
 * road was longer than the straight line suggests, which is the usual case —
 * is quoting a measured number the customer has already agreed to, and nothing
 * here second-guesses it.
 *
 * Skipped entirely once an order carries a route_km, because then the road was
 * actually measured and this estimate has no business overriding it. The
 * straight-line correction deliberately overshoots the median trip; applying it
 * on top of a real measurement would charge for a detour that was not taken.
 */
create or replace function apply_delivery_fee_floor(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o         orders%rowtype;
  s         app_settings%rowtype;
  v_km      double precision;
  v_floor   numeric;
begin
  select * into o from orders where id = p_order_id;
  if not found then return jsonb_build_object('updated', false, 'reason', 'no_order'); end if;

  -- A measured road beats an estimate of one.
  if o.route_km is not null then
    return jsonb_build_object('updated', false, 'reason', 'measured');
  end if;
  -- A finished order's fee is a record of what was charged.
  if o.status in ('delivered', 'cancelled') then
    return jsonb_build_object('updated', false, 'reason', 'finished');
  end if;
  -- Nothing to collect, nothing to floor: a collection, or a delivery the
  -- operator prices by hand once they see what was bought.
  if coalesce(o.fulfilment, 'delivery') <> 'delivery' or coalesce(o.delivery_fee, 0) <= 0 then
    return jsonb_build_object('updated', false, 'reason', 'not_priced_by_distance');
  end if;

  select * into s from app_settings limit 1;
  if s.delivery_fee_model is distinct from 'per_km' then
    return jsonb_build_object('updated', false, 'reason', 'flat_pricing');
  end if;

  select max(km_between(p.lat, p.lng, o.delivery_lat, o.delivery_lng))
    into v_km
    from order_origin_pins(p_order_id) p
   where o.delivery_lat is not null and o.delivery_lng is not null;
  if v_km is null then
    -- The database cannot see a leg either. Nothing to say.
    return jsonb_build_object('updated', false, 'reason', 'no_origin');
  end if;

  v_floor := fee_for_km((v_km * coalesce(s.route_detour_factor, 1.35))::numeric);
  if o.delivery_fee >= v_floor then
    return jsonb_build_object('updated', false, 'reason', 'already_enough',
                              'fee', o.delivery_fee, 'floor', v_floor);
  end if;

  update orders set delivery_fee = v_floor where id = p_order_id;
  perform recalc_order_commission(p_order_id);

  return jsonb_build_object('updated', true, 'straight_km', round(v_km::numeric, 3),
                            'old_fee', o.delivery_fee, 'new_fee', v_floor);
end;
$$;

revoke all on function apply_delivery_fee_floor(uuid) from public;
revoke execute on function apply_delivery_fee_floor(uuid) from anon, authenticated;

/**
 * Fired once the order can be measured.
 *
 * Twice, because the two services learn where they start at different moments:
 * pabili and padala carry the pickup pin on the order row itself, while a food
 * order's shops arrive immediately afterwards in order_stores — so at the
 * moment the order row lands there is nothing yet to measure from.
 */
create or replace function floor_fee_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Branched with IF rather than CASE: plpgsql resolves every field reference
  -- in an expression before it picks a branch, so `new.order_id` inside a CASE
  -- is looked up on the orders row too, where there is no such column.
  if tg_table_name = 'order_stores' then
    perform apply_delivery_fee_floor(new.order_id);
  else
    perform apply_delivery_fee_floor(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_fee_floor on orders;
create trigger orders_fee_floor
  after insert on orders
  for each row execute function floor_fee_after_insert();

drop trigger if exists order_stores_fee_floor on order_stores;
create trigger order_stores_fee_floor
  after insert on order_stores
  for each row execute function floor_fee_after_insert();
