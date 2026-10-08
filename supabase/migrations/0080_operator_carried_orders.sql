-- An order the operator carries themselves still has to move.
--
-- Assigning a vehicle told the customer the fee and nothing else. The order
-- stayed `pending`, because `pending` is what an order is until a rider accepts
-- it — and on an in-house run no rider ever will. So the customer watched a
-- placed order sit at "pending" while a kuliglig was already on its way to
-- them, and the only order this has happened to so far was cancelled.
--
-- The same hole swallows pick-ups: nobody is coming to collect them for the
-- customer, so nothing ever moves them off `pending` either.
--
-- Two orders exist in this system, then: the ones a rider carries, and the ones
-- the operator carries. The first kind has always had a way to progress. This
-- gives the second kind one.

-- Is this an order no rider will ever touch — a pick-up, or one of the
-- operator's own vehicles? Those are the operator's to drive.
create or replace function is_operator_carried(o orders)
returns boolean language sql immutable as $$
  select o.rider_id is null
     and (o.fulfilment = 'pickup' or o.delivery_handler = 'in_house');
$$;

-- The steps such an order can walk through, in order, from where it is now.
--
-- A pick-up has no journey: it is accepted, it is prepared, and the customer
-- collects it. Putting "on the way" in front of someone walking to the shop
-- would be a lie told by the software.
create or replace function operator_order_flow(o orders)
returns order_status[] language sql immutable as $$
  select case
    when o.fulfilment = 'pickup'
      then array['pending', 'accepted', 'preparing', 'delivered']::order_status[]
    when o.service_type = 'padala'
      then array['pending', 'accepted', 'picked_up', 'on_the_way', 'delivered']::order_status[]
    else array['pending', 'accepted', 'preparing', 'picked_up', 'on_the_way', 'delivered']::order_status[]
  end;
$$;

-- What the customer should read at each step. The words differ by who is
-- carrying it: "picked up" means the rider has your things, but on a pick-up
-- order "delivered" means you came and got them.
create or replace function operator_status_message(o orders, s order_status, v_label text)
returns text language sql immutable as $$
  select case
    when o.fulfilment = 'pickup' then case s
      when 'accepted'  then '✅ Your order is confirmed. We''ll let you know when it''s ready to collect.'
      when 'preparing' then '👨‍🍳 We''re preparing your order now.'
      when 'delivered' then '🎉 Collected — thank you!'
      when 'cancelled' then '❌ This order has been cancelled.'
      else null end
    else case s
      when 'accepted'  then format('✅ Your order is confirmed and assigned to %s.', v_label)
      when 'preparing' then '👨‍🍳 We''re preparing your order now.'
      when 'picked_up' then format('📦 %s has your order and is setting off.', v_label)
      when 'on_the_way' then format('🛵 %s is on the way to you.', v_label)
      when 'delivered' then '🎉 Delivered — thank you!'
      when 'cancelled' then '❌ This order has been cancelled.'
      else null end
  end;
$$;

-- What is carrying this order, in words a customer would use.
create or replace function order_carrier_label(o orders)
returns text language sql stable as $$
  select coalesce(
    (select d.name from delivery_options d where d.id = o.delivery_option_id),
    'our own vehicle');
$$;

-- The operator moves one of their own orders along.
create or replace function admin_advance_order(p_order_id uuid, p_next text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o       orders%rowtype;
  v_next  order_status;
  v_flow  order_status[];
  v_at    int;
  v_label text;
  v_msg   text;
begin
  if not is_staff() then raise exception 'not allowed'; end if;

  select * into o from orders where id = p_order_id;
  if not found then raise exception 'no such order'; end if;
  if not is_operator_carried(o) then
    raise exception 'A rider is carrying this order — they move it along, not you.';
  end if;

  v_next := p_next::order_status;

  if v_next = 'cancelled' then
    if o.status = 'delivered' then raise exception 'This order is already delivered.'; end if;
  else
    v_flow := operator_order_flow(o);
    v_at := array_position(v_flow, o.status);
    if v_at is null or v_at = array_length(v_flow, 1) or v_flow[v_at + 1] <> v_next then
      raise exception 'This order cannot go from % to %.', o.status, v_next;
    end if;
  end if;

  update orders set status = v_next where id = p_order_id;
  insert into order_status_events (order_id, status, changed_by)
  values (p_order_id, v_next, auth.uid());

  v_label := order_carrier_label(o);
  v_msg := operator_status_message(o, v_next, v_label);
  if v_msg is not null then
    perform post_order_system_message(p_order_id, 'admin', v_msg);
  end if;

  return jsonb_build_object('status', v_next, 'carrier', v_label);
end;
$$;

revoke all on function admin_advance_order(uuid, text) from public;
grant execute on function admin_advance_order(uuid, text) to authenticated;

-- Assigning a vehicle is the operator accepting the order. Say so, in the one
-- field the customer's app actually reads.
create or replace function admin_set_delivery(
  p_order_id uuid,
  p_handler  text,
  p_option_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o        orders%rowtype;
  opt      delivery_options%rowtype;
  v_fee    numeric;
  v_label  text;
begin
  if not is_staff() then raise exception 'not allowed'; end if;
  if p_handler not in ('easybuy', 'in_house') then
    raise exception 'handler must be easybuy or in_house';
  end if;

  select * into o from orders where id = p_order_id;
  if not found then raise exception 'no such order'; end if;
  if o.fulfilment <> 'delivery' then
    raise exception 'This is a pick-up order — there is nothing to deliver.';
  end if;
  if o.rider_id is not null then
    raise exception 'A rider already has this order; releasing it first is the only way to change the carrier.';
  end if;

  if p_handler = 'in_house' then
    if p_option_id is null then raise exception 'Choose a vehicle.'; end if;
    select * into opt from delivery_options where id = p_option_id and is_active;
    if not found then raise exception 'That vehicle is not available.'; end if;
    v_fee := opt.fee;
    v_label := opt.name;
  else
    -- Back to the rider network: priced by distance like any other delivery.
    v_fee := case
      when o.delivery_lat is not null and o.delivery_lng is not null
        then quote_delivery_fee(p_order_id, o.delivery_lat, o.delivery_lng)
      else o.delivery_fee end;
    v_label := 'Easy Buy rider';
  end if;

  update orders
     set delivery_handler   = p_handler,
         delivery_option_id = case when p_handler = 'in_house' then p_option_id else null end,
         delivery_fee       = v_fee
   where id = p_order_id;

  perform recalc_order_commission(p_order_id);

  perform post_order_system_message(p_order_id, 'admin',
    format('🚚 Your order will be delivered by %s. Delivery fee: %s.',
           v_label, to_char(v_fee, 'FM₱999G999D00')));

  -- Taking it on one of our own vehicles is us accepting it. Leaving it
  -- `pending` would have the customer waiting on a rider who is never coming.
  if p_handler = 'in_house' and o.status = 'pending' then
    update orders set status = 'accepted' where id = p_order_id;
    insert into order_status_events (order_id, status, changed_by)
    values (p_order_id, 'accepted', auth.uid());
    perform post_order_system_message(p_order_id, 'admin',
      format('✅ Your order is confirmed and assigned to %s.', v_label));
  end if;

  -- Handing it back to the rider network undoes that: it belongs in the pool
  -- again, and the pool is only ever `pending`.
  if p_handler = 'easybuy' and o.status = 'accepted' and o.rider_id is null then
    update orders set status = 'pending' where id = p_order_id;
    insert into order_status_events (order_id, status, changed_by)
    values (p_order_id, 'pending', auth.uid());
  end if;

  return jsonb_build_object('handler', p_handler, 'fee', v_fee, 'label', v_label);
end;
$$;

revoke all on function admin_set_delivery(uuid, text, uuid) from public;
grant execute on function admin_set_delivery(uuid, text, uuid) to authenticated;

-- A pick-up order was never going to a rider either, so it should not have been
-- left sitting in `pending` waiting for one. Anything already placed and still
-- stuck there is the operator's to move now.
update orders
   set status = 'accepted'
 where status = 'pending'
   and rider_id is null
   and (fulfilment = 'pickup' or delivery_handler = 'in_house');
