import { useEffect, useState } from 'react';
import { listActiveOrdersAdmin, adminCancelOrder } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import {
  listDeliveryOptions, adminSetDelivery, adminAdvanceOrder, operatorFlow,
  type DeliveryOption,
} from '@ebd/supabase';
import { Th, Td, Muted, ErrorNote, Card, peso } from './ui.tsx';
import { errMessage } from '@ebd/shared';

interface RiderRef { id: string; name: string; mobile_number: string | null }
interface OrderRow {
  id: string;
  service_type: string;
  status: string;
  delivery_fee: number;
  commission_amount: number;
  customer_contact: string;
  created_at: string;
  rider: RiderRef | null;
  notes?: string | null;
  fulfilment?: 'pickup' | 'delivery';
  delivery_handler?: 'easybuy' | 'in_house' | null;
  delivery_option_id?: string | null;
}

const now = new Date();
const SAMPLE: OrderRow[] = [
  { id: 'o1', service_type: 'food', status: 'pending', delivery_fee: 50, commission_amount: 7.5, customer_contact: '0917 111 2222', created_at: new Date(now.getTime() - 3 * 60000).toISOString(), rider: null },
  { id: 'o2', service_type: 'pabili', status: 'accepted', delivery_fee: 60, commission_amount: 9, customer_contact: '0917 333 4444', created_at: new Date(now.getTime() - 18 * 60000).toISOString(), rider: { id: 'r1', name: 'Juan Dela Cruz', mobile_number: '0917 000 1111' } },
  { id: 'o3', service_type: 'padala', status: 'on_the_way', delivery_fee: 40, commission_amount: 6, customer_contact: '0917 555 6666', created_at: new Date(now.getTime() - 42 * 60000).toISOString(), rider: { id: 'r2', name: 'Maria Santos', mobile_number: '0917 000 2222' } },
];

const serviceColor: Record<string, string> = {
  food: 'bg-brand-green/15 text-green-800',
  pabili: 'bg-brand-purple/15 text-brand-purple',
  padala: 'bg-brand-yellow/30 text-yellow-800',
};

/** "2:45 PM" (Manila) plus a relative hint like "3m ago". */
function formatWhen(iso: string): { time: string; ago: string } {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago`
    : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
  return { time, ago };
}

export function LiveOrders({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    if (!supabase) return;
    try { setRows((await listActiveOrdersAdmin(supabase)) as OrderRow[]); setError(null); }
    catch (e) { setError(errMessage(e)); }
  }

  async function cancel(o: OrderRow) {
    if (!supabase) return;
    const reason = window.prompt(
      `Cancel this ${o.service_type} order?\n\nReason (added to the order notes):`, '');
    if (reason === null) return;
    setBusyId(o.id);
    try {
      const ok = await adminCancelOrder(supabase, o.id, reason.trim() || undefined);
      if (!ok) window.alert('This order could not be cancelled (already delivered?).');
      await reload();
    } catch (e) { setError(errMessage(e)); }
    finally { setBusyId(null); }
  }

  // The operator's own vehicles, for assigning a carrier to a shop order.
  const [vehicles, setVehicles] = useState<DeliveryOption[]>([]);
  useEffect(() => {
    if (!supabase) return;
    listDeliveryOptions(supabase).then(setVehicles).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!supabase) { setRows(SAMPLE); setLoading(false); return; }
      try {
        const data = (await listActiveOrdersAdmin(supabase)) as OrderRow[];
        if (alive) { setRows(data); setError(null); }
      } catch (e) {
        if (alive) setError(errMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    // Keep the timestamps and assignments fresh.
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-black/50">
          <tr className="border-b border-black/5">
            <Th>Time</Th><Th>Service</Th><Th>Status</Th><Th>Rider</Th><Th>Contact</Th><Th>Fee</Th><Th>Commission</Th><Th> </Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><Td className="text-black/40">No active orders right now.</Td></tr>}
          {rows.map((o) => {
            const when = formatWhen(o.created_at);
            return (
              <tr key={o.id} className="border-b border-black/[0.04]">
                <Td>
                  <span className="font-medium">{when.time}</span>
                  <span className="mt-0.5 block text-xs text-black/40">{when.ago}</span>
                </Td>
                <Td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${serviceColor[o.service_type] ?? 'bg-black/5'}`}>{o.service_type}</span></Td>
                <Td>
                  <span className="capitalize">{o.status.replaceAll('_', ' ')}</span>
                  {/* Nobody else is going to move this one along. */}
                  {!o.rider && (o.fulfilment === 'pickup' || o.delivery_handler === 'in_house') && (
                    <AdvanceOrder order={o} onDone={reload} />
                  )}
                </Td>
                <Td>
                  {o.fulfilment === 'pickup' ? (
                    <span className="rounded-full bg-brand-purple/15 px-2 py-0.5 text-xs font-medium text-brand-purple">🏪 Pick-up</span>
                  ) : o.rider ? (
                    <>
                      <span className="font-medium">{o.rider.name}</span>
                      {o.rider.mobile_number && <span className="mt-0.5 block text-xs text-black/40">{o.rider.mobile_number}</span>}
                    </>
                  ) : o.delivery_handler == null ? (
                    <Carrier order={o} options={vehicles} onDone={reload} />
                  ) : o.delivery_handler === 'in_house' ? (
                    <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-xs font-medium text-green-800">
                      🚚 {vehicles.find((v) => v.id === o.delivery_option_id)?.name ?? 'In-house'}
                    </span>
                  ) : (
                    <span className="rounded-full bg-brand-yellow/30 px-2 py-0.5 text-xs font-medium text-yellow-800">Waiting for a rider</span>
                  )}
                </Td>
                <Td>
                  {o.customer_contact}
                  {o.notes && <span className="mt-0.5 block text-xs text-yellow-800">📝 {o.notes}</span>}
                </Td>
                <Td>{peso(o.delivery_fee)}</Td>
                <Td className="font-medium">{peso(o.commission_amount)}</Td>
                <Td>
                  <button onClick={() => cancel(o)} disabled={busyId === o.id}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50">
                    {busyId === o.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return embedded ? table : <Card title="Live orders">{table}</Card>;
}


const NEXT_LABEL: Record<string, string> = {
  accepted: 'Confirm order',
  preparing: 'Start preparing',
  picked_up: 'Loaded',
  on_the_way: 'Set off',
  delivered: 'Delivered',
};

/**
 * Move an order the operator is carrying to its next step.
 *
 * A rider drives their own deliveries from the rider app; an in-house run or a
 * collection has no rider, so nobody was driving these at all. They sat at
 * whatever status they were left on, and the customer — who reads that same
 * field — saw an order that never moved. Each press tells them in the chat.
 */
function AdvanceOrder({ order, onDone }: {
  order: { id: string; status: string; service_type: string; fulfilment?: string };
  onDone: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const flow = operatorFlow(order.fulfilment, order.service_type);
  const at = flow.indexOf(order.status);
  const next = at >= 0 && at < flow.length - 1 ? flow[at + 1] : null;
  if (!next) return null;

  const label = order.fulfilment === 'pickup' && next === 'delivered'
    ? 'Collected' : NEXT_LABEL[next] ?? next;

  return (
    <>
      <button disabled={busy}
        onClick={async () => {
          if (!supabase) return;
          setBusy(true); setErr(null);
          try { await adminAdvanceOrder(supabase, order.id, next); await onDone(); }
          catch (e) { setErr(errMessage(e)); }
          finally { setBusy(false); }
        }}
        className="mt-1 block rounded-lg bg-brand-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? '…' : `→ ${label}`}
      </button>
      {err && <span className="mt-1 block text-[11px] text-red-600">{err}</span>}
    </>
  );
}

/**
 * Who carries this order, chosen once the operator can see what was bought.
 *
 * Until this is answered the order sits still: no rider can see it, because a
 * rider taking a sack of rice meant for the van would strand the customer. The
 * customer is told the fee in the order chat the moment it is set — they agreed
 * to the order without knowing it, so they hear it from us, not at the door.
 */
function Carrier({ order, options, onDone }: {
  order: { id: string };
  options: DeliveryOption[];
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function assign(handler: 'easybuy' | 'in_house', optionId?: string) {
    if (!supabase) return;
    setBusy(true); setErr(null);
    try { await adminSetDelivery(supabase, order.id, handler, optionId); await onDone(); }
    catch (e) { setErr(errMessage(e)); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-purple px-2.5 py-1 text-xs font-semibold text-white">
        Choose carrier
      </button>
    );
  }

  return (
    <div className="min-w-[11rem] space-y-1.5">
      <button disabled={busy} onClick={() => void assign('easybuy')}
        className="w-full rounded-lg border border-black/10 px-2 py-1 text-left text-xs font-medium disabled:opacity-50">
        🛵 Easy Buy rider <span className="text-black/40">— fee by distance</span>
      </button>
      {options.map((v) => (
        <button key={v.id} disabled={busy} onClick={() => void assign('in_house', v.id)}
          className="flex w-full items-center gap-2 rounded-lg border border-black/10 px-2 py-1 text-left text-xs font-medium disabled:opacity-50">
          {v.image_url
            ? <img src={v.image_url} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
            : <span className="shrink-0">🚚</span>}
          <span className="min-w-0 flex-1 truncate">{v.name}</span>
          <span className="shrink-0 text-black/50">{peso(Number(v.fee))}</span>
        </button>
      ))}
      {options.length === 0 && (
        <p className="text-[11px] text-black/45">No vehicles yet — add them under Settings.</p>
      )}
      {err && <p className="text-[11px] text-red-600">{err}</p>}
      <button onClick={() => setOpen(false)} className="text-[11px] text-black/40">Cancel</button>
    </div>
  );
}
