-- Tell the rider when their order is cancelled.
--
-- Cancelling an order a rider is already carrying wrote a status, a note, and
-- an audit row — and told nobody. Not the rider holding the goods, not the
-- customer. The rider's app filters cancelled orders out of their active list,
-- so the job simply vanished from their screen at whatever moment the list
-- next happened to reload, with no explanation and nothing to read afterwards.
--
-- A rider who has already paid for a sack of rice deserves better than a job
-- quietly disappearing. So cancelling now says so, in the order chat, with the
-- reason the operator gave — the same place every other thing said about an
-- order already lives.

-- When it happened, so "cancelled while you were out" can be answered without
-- guessing from created_at. Mirrors delivered_at from 0054.
alter table orders
  add column if not exists cancelled_at timestamptz;

comment on column orders.cancelled_at is
  'Stamped when the order flips to cancelled, so a rider can be shown what went while they were away.';

create or replace function stamp_cancelled_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stamp_cancelled_at on orders;
create trigger orders_stamp_cancelled_at
  before update on orders
  for each row execute function stamp_cancelled_at();

-- Backfill what we can: the audit trail knows when each one was cancelled.
update orders o
   set cancelled_at = e.at
  from (
    select order_id, max(created_at) as at
      from order_status_events
     where status = 'cancelled'
     group by order_id
  ) e
 where e.order_id = o.id
   and o.status = 'cancelled'
   and o.cancelled_at is null;

-- The operator cancels, and everyone on the order is told.
create or replace function admin_cancel_order(p_order_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n        int;
  v_reason text := nullif(btrim(p_reason), '');
  v_rider  uuid;
begin
  if not is_staff() then
    raise exception 'not authorised';
  end if;

  select rider_id into v_rider from orders where id = p_order_id;

  update orders set
    status = 'cancelled',
    notes  = case when v_reason is null then notes
                  else coalesce(notes || E'\n', '') || 'Cancelled by admin: ' || v_reason end
  where id = p_order_id and status <> 'delivered';
  get diagnostics n = row_count;

  if n > 0 then
    insert into order_status_events (order_id, status) values (p_order_id, 'cancelled');

    -- Said once, in the order chat, where both the customer and the rider
    -- carrying it will find it. The reason matters most to the rider: "we
    -- cancelled it" and "the customer changed their mind" call for different
    -- things from someone standing in a shop with the goods in their hand.
    perform post_order_system_message(p_order_id, 'admin',
      case when v_reason is null
        then '❌ This order has been cancelled by the operator.'
        else format('❌ This order has been cancelled by the operator. Reason: %s', v_reason)
      end);
  end if;

  return n > 0;
end;
$$;

revoke all on function admin_cancel_order(uuid, text) from public;
grant execute on function admin_cancel_order(uuid, text) to authenticated;
