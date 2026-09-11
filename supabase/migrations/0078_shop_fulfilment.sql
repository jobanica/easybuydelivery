-- Pick-up or delivery for the own shop, and who carries it.
--
-- The shop is not a restaurant. A sack of rice and a case of softdrinks do not
-- go on a motorbike, and plenty of customers would rather collect than pay to
-- have it brought. So an order from the own shop answers two questions the
-- restaurants never had to: am I collecting this, and if not, what carries it.
--
-- The operator decides the carrier, per order, after seeing what was bought —
-- which means the customer places the order without knowing the delivery fee.
-- That is a deliberate trade for control, and it puts an obligation on us: the
-- moment a fee is set, the customer is told in the order chat. Nobody should
-- discover a charge at the door.

-- A category can carry its supplier's logo, so the shelves read like shelves.
alter table menu_categories
  add column if not exists image_url text;

-- What the operator can put an order on. Names and prices are theirs to set:
-- a tricycle in one town is a kuliglig in the next, and neither belongs in a
-- hardcoded list.
create table if not exists delivery_options (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  fee         numeric(10,2) not null default 0 check (fee >= 0),
  image_url   text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table delivery_options enable row level security;

drop policy if exists delivery_options_public_read on delivery_options;
create policy delivery_options_public_read on delivery_options
  for select using (true);

drop policy if exists delivery_options_staff_write on delivery_options;
create policy delivery_options_staff_write on delivery_options
  for all using (is_staff()) with check (is_staff());

-- How this particular order reaches the customer.
alter table orders
  add column if not exists fulfilment text not null default 'delivery'
    check (fulfilment in ('pickup', 'delivery')),
  -- 'easybuy' = the rider network, 'in_house' = the operator's own vehicle.
  -- NULL means nobody has decided yet, which is where a shop delivery starts.
  -- Everything that existed before this migration is 'easybuy', because it was.
  add column if not exists delivery_handler text default 'easybuy'
    check (delivery_handler in ('easybuy', 'in_house')),
  add column if not exists delivery_option_id uuid references delivery_options (id);

comment on column orders.delivery_handler is
  'Who carries this order. NULL = awaiting the operator''s decision; such an order is invisible to riders.';

-- Riders see only what is theirs to take: a delivery, assigned to the network.
-- An order awaiting the operator's decision, or one going on the operator's own
-- tricycle, or a collection — none of those are a rider's to pick up, and a
-- rider claiming one would strand a customer waiting on the operator.
drop policy if exists orders_rider_read on orders;
create policy orders_rider_read on orders
  for select using (
    current_rider_id() is not null
    and (
      rider_id = current_rider_id()
      or (
        rider_id is null
        and status = 'pending'
        and fulfilment = 'delivery'
        and delivery_handler = 'easybuy'
      )
    )
  );

drop policy if exists orders_rider_claim on orders;
create policy orders_rider_claim on orders
  for update using (
    rider_id is null
    and status = 'pending'
    and fulfilment = 'delivery'
    and delivery_handler = 'easybuy'
    and current_rider_id() is not null
    and exists (
      select 1 from riders r
       where r.id = current_rider_id()
         and r.application_status = 'approved'
         and r.is_suspended = false
    )
    and rider_overdue_balance(current_rider_id(), (now() at time zone 'Asia/Manila')::date) = 0
  ) with check (rider_id = current_rider_id());

-- The operator speaks in the order chat too. Quoting a delivery fee is the shop
-- talking, not a rider — and on an in-house run there is no rider to speak.
alter table order_messages drop constraint if exists order_messages_sender_role_check;
alter table order_messages
  add constraint order_messages_sender_role_check
  check (sender_role in ('customer', 'rider', 'admin'));

-- The operator assigns a carrier and, with it, the price.
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

  return jsonb_build_object('handler', p_handler, 'fee', v_fee, 'label', v_label);
end;
$$;

revoke all on function admin_set_delivery(uuid, text, uuid) from public;
grant execute on function admin_set_delivery(uuid, text, uuid) to authenticated;
