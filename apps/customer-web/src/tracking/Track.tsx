import { useCallback, useEffect, useState } from 'react';
import { getActiveDelivery, getOrderRiderInfo, respondToItemChange, cancelEmptyOrder,
  type ActiveDelivery, type OrderRiderInfo } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { TrackingMap } from './TrackingMap.tsx';
import { PayRider } from '../PayRider.tsx';
import { ChatButton } from '../Chat.tsx';
import { peso } from '../ui.tsx';
import { errMessage } from '@ebd/shared';

/** "My order" — what the customer ordered, shown alongside the live map. */
function OrderItemsCard({ delivery, onChange }: { delivery: ActiveDelivery; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (delivery.items.length === 0) return null;

  const proposed = delivery.items.filter((it) => it.status === 'proposed');
  const soldOut = delivery.items.filter((it) => it.status === 'sold_out');
  const live = delivery.items.filter((it) => (it.status ?? 'ok') === 'ok');
  const nothingLeft = live.length === 0 && proposed.length === 0 && soldOut.length > 0;

  async function respond(itemId: string, accept: boolean) {
    if (!supabase) return;
    setBusy(itemId); setErr(null);
    try { await respondToItemChange(supabase, itemId, accept); onChange(); }
    catch (e) { setErr(errMessage(e)); }
    finally { setBusy(null); }
  }
  async function cancelAll() {
    if (!supabase) return;
    if (!window.confirm('Cancel this order? Everything you ordered is sold out.')) return;
    setBusy('cancel'); setErr(null);
    try {
      if (!(await cancelEmptyOrder(supabase, delivery.id))) setErr('Some items are still available — this order can’t be cancelled here.');
      onChange();
    } catch (e) { setErr(errMessage(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">My order</h3>
        {delivery.storeName && <span className="truncate text-xs text-black/45">{delivery.storeName}</span>}
      </div>
      <ul className="space-y-1 text-sm">
        {live.map((it, i) => (
          <li key={it.id ?? i} className="flex justify-between gap-2">
            <span className="min-w-0"><span className="font-medium">{it.qty}×</span> {it.name}</span>
            {it.unitPrice > 0 && <span className="shrink-0 text-black/50">{peso(it.unitPrice * it.qty)}</span>}
          </li>
        ))}
        {soldOut.map((it, i) => (
          <li key={it.id ?? `s${i}`} className="flex justify-between gap-2 text-black/35">
            <span className="min-w-0 line-through"><span className="font-medium">{it.qty}×</span> {it.name}</span>
            <span className="shrink-0 text-[11px] font-medium text-red-500">sold out</span>
          </li>
        ))}
      </ul>

      {/* The rider found something else — nothing is charged until you agree. */}
      {proposed.map((it) => (
        <div key={it.id} className="mt-3 rounded-lg bg-brand-yellow/20 p-3 ring-1 ring-brand-yellow/50">
          <p className="text-sm font-bold text-brand-ink">🔁 Your rider suggests a replacement</p>
          <p className="mt-1 text-sm">
            <span className="font-medium">{it.qty}× {it.name}</span>
            {it.unitPrice > 0 && <span className="text-black/55"> · {peso(it.unitPrice * it.qty)}</span>}
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void respond(it.id!, true)} disabled={busy === it.id}
              className="flex-1 rounded-lg bg-brand-green py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy === it.id ? '…' : 'Accept'}
            </button>
            <button onClick={() => void respond(it.id!, false)} disabled={busy === it.id}
              className="flex-1 rounded-lg border border-black/15 py-2 text-sm font-medium text-black/60 disabled:opacity-50">
              No thanks
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-black/50">You’re not charged for this unless you accept it.</p>
        </div>
      ))}

      {nothingLeft && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-sm font-medium text-red-700">Everything you ordered is sold out.</p>
          <button onClick={() => void cancelAll()} disabled={busy === 'cancel'}
            className="mt-2 w-full rounded-lg border border-red-300 py-2 text-sm font-semibold text-red-600 disabled:opacity-50">
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel this order'}
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Demo route for preview mode (no backend).
const DEMO_PICKUP = { lat: 14.170, lng: 121.240 };
const DEMO_DROPOFF = { lat: 14.186, lng: 121.256 };

/**
 * Track tab: finds the customer's current in-progress delivery and shows the
 * live rider map for it. Falls back to a simulated demo in preview mode and a
 * friendly empty state when there's nothing to track.
 */
export function Track({ onClose }: { onClose: () => void }) {
  const { live, customerId } = useAuth();
  const [status, setStatus] = useState<'loading' | 'none' | 'ok' | 'nocoords'>('loading');
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [riderInfo, setRiderInfo] = useState<OrderRiderInfo | null>(null);

  const load = useCallback(async () => {
    if (!live || !supabase || !customerId) return;
    try {
      const d = await getActiveDelivery(supabase, customerId);
      setDelivery(d);
      setStatus(!d ? 'none' : d.pickup && d.dropoff ? 'ok' : 'nocoords');
      setRiderInfo(d ? await getOrderRiderInfo(supabase, d.id).catch(() => null) : null);
    } catch {
      setStatus('none');
    }
  }, [live, customerId]);

  useEffect(() => {
    void load();
    // Re-check which order is active, its status, and any sold-out changes.
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Preview mode: show the simulated demo so the map is demonstrable.
  if (!live) return <TrackingMap pickup={DEMO_PICKUP} dropoff={DEMO_DROPOFF} onClose={onClose} />;

  if (status === 'ok' && delivery?.pickup && delivery.dropoff) {
    return (
      <div className="space-y-3">
        <TrackingMap pickup={delivery.pickup} dropoff={delivery.dropoff} orderId={delivery.id}
          deliveryStatus={delivery.status} courier={riderInfo} onClose={onClose} />
        <ChatButton orderId={delivery.id} role="customer" title="Chat with your rider" />
        <OrderItemsCard delivery={delivery} onChange={() => void load()} />
        {delivery.payment_method === 'rider_qr' && <PayRider orderId={delivery.id} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">Track your delivery</h2>
          <button onClick={onClose} className="text-sm text-brand-purple">Close</button>
        </div>
        {status === 'loading' ? (
          <p className="py-6 text-sm text-black/50">Checking for an active delivery…</p>
        ) : status === 'nocoords' ? (
          <p className="py-6 text-sm text-black/60">
            Your rider is on the way ({delivery?.status.replaceAll('_', ' ')}). A live map isn't available for this order because no map location was set.
          </p>
        ) : (
          <>
            <div className="mx-auto mb-3 mt-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">🛵</div>
            <p className="text-sm text-black/60">No delivery in progress. Live tracking appears here once a rider is on the way with your order.</p>
          </>
        )}
      </div>
      {delivery && <OrderItemsCard delivery={delivery} onChange={() => void load()} />}
      {delivery?.payment_method === 'rider_qr' && <PayRider orderId={delivery.id} />}
    </div>
  );
}
