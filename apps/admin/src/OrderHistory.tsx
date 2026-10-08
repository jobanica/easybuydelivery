import { useEffect, useState } from 'react';
import { listOrders, getOrderDetail } from '@ebd/supabase';
import type { ServiceType, OrderStatus } from '@ebd/shared';
import { errMessage } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { useDayRange } from './DateRange.tsx';
import { Card, Th, Td, Muted, ErrorNote, peso } from './ui.tsx';
import { PrintReceipt } from './PrintReceipt.tsx';

interface OrderRow {
  id: string;
  created_at: string;
  service_type: string;
  status: string;
  /** Who the rider asks for. Not every old order has one. */
  customer_name: string | null;
  customer_contact: string;
  goods_cost: number;
  delivery_fee: number;
  commission_amount: number;
  payment_method: string;
  payment_status: string;
  /** The GCash screenshot the customer uploaded, when they paid that way. */
  payment_receipt_url: string | null;
  payment_reference: string | null;
  /** Set when the rider confirmed the money actually landed. */
  payment_confirmed_at: string | null;
}

const SAMPLE: OrderRow[] = [
  { id: 'h1', created_at: '2026-07-19T09:12:00Z', service_type: 'food', status: 'delivered', customer_name: 'Maria Santos', customer_contact: '0917 111 2222', goods_cost: 280, delivery_fee: 50, commission_amount: 7.5, payment_method: 'cod', payment_status: 'paid', payment_receipt_url: null, payment_reference: null, payment_confirmed_at: null },
  { id: 'h2', created_at: '2026-07-19T08:40:00Z', service_type: 'pabili', status: 'delivered', customer_name: 'Juan Dela Cruz', customer_contact: '0917 333 4444', goods_cost: 540, delivery_fee: 60, commission_amount: 9, payment_method: 'rider_qr', payment_status: 'paid', payment_receipt_url: 'https://placehold.co/400x600', payment_reference: '0123456789', payment_confirmed_at: '2026-07-19T08:55:00Z' },
  { id: 'h3', created_at: '2026-07-19T08:05:00Z', service_type: 'padala', status: 'cancelled', customer_name: null, customer_contact: '0917 555 6666', goods_cost: 0, delivery_fee: 40, commission_amount: 6, payment_method: 'online', payment_status: 'paid', payment_receipt_url: null, payment_reference: null, payment_confirmed_at: null },
  { id: 'h4', created_at: '2026-07-18T19:20:00Z', service_type: 'food', status: 'delivered', customer_name: 'Cletty', customer_contact: '0917 777 8888', goods_cost: 190, delivery_fee: 50, commission_amount: 7.5, payment_method: 'rider_qr', payment_status: 'unpaid', payment_receipt_url: 'https://placehold.co/400x600', payment_reference: null, payment_confirmed_at: null },
];

const SERVICES: (ServiceType | 'all')[] = ['all', 'food', 'pabili', 'padala'];
const STATUSES: (OrderStatus | 'all')[] = ['all', 'pending', 'accepted', 'preparing', 'picked_up', 'on_the_way', 'delivered', 'cancelled'];
const PAGE = 20;

const serviceChip: Record<string, string> = {
  food: 'bg-brand-green/15 text-green-800',
  pabili: 'bg-brand-purple/15 text-brand-purple',
  padala: 'bg-brand-yellow/30 text-yellow-800',
};
const statusChip = (s: string) =>
  s === 'delivered' ? 'bg-brand-green/15 text-green-800'
  : s === 'cancelled' ? 'bg-red-100 text-red-700'
  : 'bg-black/5 text-black/60';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function OrderHistory() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [count, setCount] = useState(0);
  const [service, setService] = useState<ServiceType | 'all'>('all');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const dates = useDayRange(30);
  // A new span is a new list; page 5 of the old one means nothing in it.
  useEffect(() => { setPage(0); }, [dates.key]);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      if (!supabase) {
        let r = SAMPLE;
        if (service !== 'all') r = r.filter((o) => o.service_type === service);
        if (status !== 'all') r = r.filter((o) => o.status === status);
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          r = r.filter((o) => o.customer_contact.includes(q)
            || (o.customer_name ?? '').toLowerCase().includes(q));
        }
        setRows(r); setCount(r.length); setLoading(false); return;
      }
      try {
        const res = await listOrders(supabase, {
          serviceType: service === 'all' ? undefined : service,
          status: status === 'all' ? undefined : status,
          search: search || undefined,
          fromDay: dates.range.from, toDay: dates.range.to,
          limit: PAGE, offset: page * PAGE,
        });
        setRows(res.rows as unknown as OrderRow[]); setCount(res.count);
      } catch (e) { setError(errMessage(e)); }
      finally { setLoading(false); }
    })();
  }, [service, status, search, page, dates.key]);

  const pages = Math.max(1, Math.ceil(count / PAGE));

  return (
    <div className="space-y-4">
      <Card title="Filter">
        <div className="mb-3">{dates.controls}</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {SERVICES.map((s) => (
              <button key={s} onClick={() => { setService(s); setPage(0); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ring-1 transition ${
                  service === s ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'
                }`}>{s}</button>
            ))}
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value as OrderStatus | 'all'); setPage(0); }}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm capitalize outline-none focus:border-brand-green">
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replaceAll('_', ' ')}</option>)}
          </select>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search name or number"
            className="min-w-[10rem] flex-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm outline-none focus:border-brand-green" />
        </div>
      </Card>

      {loading ? <Muted>Loading…</Muted>
        : error ? <ErrorNote msg={error} />
        : rows.length === 0 ? <Muted>No orders in this period match these filters.</Muted>
        : (
        <Card title={`Orders (${count})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-black/50">
                <tr className="border-b border-black/5">
                  <Th>When</Th><Th>Service</Th><Th>Status</Th><Th>Customer</Th>
                  <Th>Goods</Th><Th>Fee</Th><Th>Commission</Th><Th>Payment</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} onClick={() => setDetailId(o.id)}
                    className="cursor-pointer border-b border-black/[0.04] hover:bg-black/[0.02]">
                    <Td className="whitespace-nowrap text-black/60">{fmtDate(o.created_at)}</Td>
                    <Td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${serviceChip[o.service_type] ?? 'bg-black/5'}`}>{o.service_type}</span></Td>
                    <Td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusChip(o.status)}`}>{o.status.replaceAll('_', ' ')}</span></Td>
                    <Td>
                      {o.customer_name
                        ? <span className="block font-medium">{o.customer_name}</span>
                        : <span className="block text-black/35">No name</span>}
                      <span className="block whitespace-nowrap text-xs text-black/50">{o.customer_contact}</span>
                    </Td>
                    <Td>{peso(o.goods_cost)}</Td>
                    <Td>{peso(o.delivery_fee)}</Td>
                    <Td className="font-medium">{peso(o.commission_amount)}</Td>
                    <Td>
                      <span className="capitalize">{o.payment_method.replaceAll('_', ' ')}</span>
                      {o.payment_status === 'paid' && <span className="ml-1 text-green-700">✓</span>}
                      <Receipt order={o} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                className="rounded-lg px-3 py-1.5 ring-1 ring-black/10 disabled:opacity-40">← Prev</button>
              <span className="text-black/50">Page {page + 1} of {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                className="rounded-lg px-3 py-1.5 ring-1 ring-black/10 disabled:opacity-40">Next →</button>
            </div>
          )}
        </Card>
      )}

      {detailId && <OrderDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

/**
 * The GCash screenshot the customer sent, on the row itself.
 *
 * These orders are settled on a picture — the customer pays by transfer and
 * uploads the confirmation. Reading "Rider Qr" in a list told the operator a
 * method and nothing about whether the money was actually sent, so the proof
 * was only ever visible to the rider who took it. It belongs here.
 */
function Receipt({ order }: { order: OrderRow }) {
  const [open, setOpen] = useState(false);
  const confirmed = Boolean(order.payment_confirmed_at);
  if (!order.payment_receipt_url && !order.payment_reference) return null;

  return (
    <span className="mt-1 flex items-center gap-1.5">
      {order.payment_receipt_url && (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          title={confirmed ? 'Proof of payment — confirmed by the rider' : 'Proof of payment — not yet confirmed'}
          className="relative block h-8 w-8 shrink-0 overflow-hidden rounded ring-1 ring-black/10">
          <img src={order.payment_receipt_url} alt="" className="h-full w-full object-cover" />
          <span className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-white ${
            confirmed ? 'bg-brand-green' : 'bg-brand-yellow text-yellow-900'}`}>
            {confirmed ? '✓' : '!'}
          </span>
        </button>
      )}
      {order.payment_reference && (
        <span className="font-mono text-[11px] text-black/50">{order.payment_reference}</span>
      )}
      {open && order.payment_receipt_url && (
        <ProofViewer order={order} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

/** The uploaded proof, big enough to actually read a reference number off. */
function ProofViewer({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  return (
    <div onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold">Proof of payment</h3>
            <p className="truncate text-xs text-black/50">
              {order.customer_name ?? 'No name'} · {order.customer_contact}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-brand-purple">Close</button>
        </div>

        <img src={order.payment_receipt_url!} alt="Payment receipt"
          className="w-full rounded-lg ring-1 ring-black/10" />

        <div className="mt-3 space-y-1 text-sm">
          <Line label="Amount" value={peso(
            Number(order.goods_cost ?? 0) + Number(order.delivery_fee ?? 0),
          )} />
          <Line label="Method" value={order.payment_method.replaceAll('_', ' ')} />
          {order.payment_reference && <Line label="Reference" value={order.payment_reference} />}
          <Line label="Confirmed"
            value={order.payment_confirmed_at ? fmtDate(order.payment_confirmed_at) : 'Not yet'} />
        </div>

        <a href={order.payment_receipt_url!} target="_blank" rel="noreferrer"
          className="mt-3 block rounded-lg bg-brand-purple py-2 text-center text-sm font-semibold text-white">
          Open full size
        </a>
      </div>
    </div>
  );
}

function OrderDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<{ order: any; items: any[]; events: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      const o = SAMPLE.find((x) => x.id === id);
      setDetail({ order: o ?? {}, items: [
        { name: 'Chicken Adobo', qty: 2, unit_price: 95 }, { name: 'Extra Rice', qty: 1, unit_price: 20 },
      ], events: [] });
      return;
    }
    getOrderDetail(supabase, id).then(setDetail).catch((e) => setError(errMessage(e)));
  }, [id]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">Order detail</h3>
          <button onClick={onClose} className="text-sm text-brand-purple">Close</button>
        </div>
        {error && <ErrorNote msg={error} />}
        {!detail ? <Muted>Loading…</Muted> : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-black/70">
              <span className="capitalize"><b className="text-brand-ink">{detail.order.service_type}</b></span>
              <span className="capitalize">Status: {String(detail.order.status ?? '').replaceAll('_', ' ')}</span>
              {detail.order.customer_name && <span>{String(detail.order.customer_name)}</span>}
              <span>Contact: {detail.order.customer_contact}</span>
            </div>
            {detail.items.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Items</p>
                <ul className="divide-y divide-black/5 rounded-lg ring-1 ring-black/5">
                  {detail.items.map((it, i) => (
                    <li key={i} className="flex justify-between px-3 py-2">
                      <span>{it.qty}× {it.name}</span>
                      <span>{peso((it.unit_price ?? 0) * (it.qty ?? 1))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-lg bg-black/[0.02] p-3">
              <Line label="Goods" value={peso(detail.order.goods_cost ?? 0)} />
              <Line label="Delivery fee" value={peso(detail.order.delivery_fee ?? 0)} />
              {Number(detail.order.store_fee_total ?? 0) > 0 &&
                <Line label="Store fee" value={peso(detail.order.store_fee_total ?? 0)} />}
              {Number(detail.order.convenience_fee ?? 0) > 0 &&
                <Line label="Convenience fee" value={peso(detail.order.convenience_fee ?? 0)} />}
              <div className="mt-1 flex justify-between border-t border-black/10 pt-1 font-bold">
                <span>Total</span>
                <span>{peso(
                  Number(detail.order.goods_cost ?? 0) + Number(detail.order.delivery_fee ?? 0)
                  + Number(detail.order.store_fee_total ?? 0) + Number(detail.order.convenience_fee ?? 0),
                )}</span>
              </div>
              <Line label="Commission" value={peso(detail.order.commission_amount ?? 0)} />
              <Line label="Payment" value={`${String(detail.order.payment_method ?? '').replaceAll('_', ' ')}${detail.order.payment_status === 'paid' ? ' ✓' : ''}`} />
              {detail.order.payment_reference &&
                <Line label="Reference" value={String(detail.order.payment_reference)} />}
            </div>
            {detail.order.payment_receipt_url && (
              <div>
                <p className="mb-1 font-medium">
                  Proof of payment
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    detail.order.payment_confirmed_at
                      ? 'bg-brand-green/15 text-green-800'
                      : 'bg-brand-yellow/30 text-yellow-800'}`}>
                    {detail.order.payment_confirmed_at ? 'Confirmed by rider' : 'Awaiting confirmation'}
                  </span>
                </p>
                <a href={String(detail.order.payment_receipt_url)} target="_blank" rel="noreferrer">
                  <img src={String(detail.order.payment_receipt_url)} alt="Payment receipt"
                    className="w-full rounded-lg ring-1 ring-black/10" />
                </a>
              </div>
            )}
            <PrintReceipt order={detail.order} items={detail.items} />

            {detail.events.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Timeline</p>
                <ul className="space-y-1 text-black/60">
                  {detail.events.map((e, i) => (
                    <li key={i} className="capitalize">• {String(e.status).replaceAll('_', ' ')} — {fmtDate(e.created_at)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between py-0.5"><span className="text-black/60">{label}</span><span className="font-medium capitalize">{value}</span></div>
);
