import { useCallback, useEffect, useState } from 'react';
import { getActiveDelivery, getOrderRiderInfo, respondToItemChange, cancelEmptyOrder,
  orderGoodsAmount, orderGoodsIsFinal, listOrderAddons, requestOrderAddon, cancelOrderAddon,
  getAppSettings, operatorFlow,
  type ActiveDelivery, type OrderRiderInfo, type OrderAddon } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { TrackingMap } from './TrackingMap.tsx';
import { PayRider } from '../PayRider.tsx';
import { ChatButton } from '../Chat.tsx';
import { peso } from '../ui.tsx';
import { errMessage, orderStatusLabel } from '@ebd/shared';
import { useArrivalAlert, ArrivalBanner, NotificationOptIn } from '../ArrivalAlert.tsx';

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

/**
 * Cash-on-delivery total. A COD customer gets no payment panel (that's only for
 * GCash-to-rider), so without this they'd reach the door not knowing what to
 * hand over. Pabili stays an estimate until the rider records the real receipt.
 */
function PayOnDelivery({ delivery }: { delivery: ActiveDelivery }) {
  const goods = orderGoodsAmount(delivery);
  const isFinal = orderGoodsIsFinal(delivery);
  const total = goods + delivery.delivery_fee + delivery.store_fee_total + delivery.convenience_fee;
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">💵 Pay on delivery</h3>
        <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[11px] font-semibold text-green-800">Cash</span>
      </div>
      <div className="space-y-1 text-sm">
        {goods > 0 && (
          <div className="flex justify-between text-black/60">
            <span>{delivery.service_type === 'food' ? 'Food subtotal' : 'Goods'}{!isFinal && ' (estimate)'}</span>
            <span>{peso(goods)}</span>
          </div>
        )}
        <div className="flex justify-between text-black/60"><span>Delivery fee</span><span>{peso(delivery.delivery_fee)}</span></div>
        {delivery.store_fee_total > 0 && (
          <div className="flex justify-between text-black/60"><span>Store fee</span><span>{peso(delivery.store_fee_total)}</span></div>
        )}
        {delivery.convenience_fee > 0 && (
          <div className="flex justify-between text-black/60"><span>Convenience fee</span><span>{peso(delivery.convenience_fee)}</span></div>
        )}
        <div className="mt-1 flex justify-between border-t border-black/10 pt-2 font-bold">
          <span>{isFinal ? 'Total to pay' : 'Estimated total'}</span>
          <span className="text-lg">{peso(total)}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-black/45">
        {isFinal
          ? 'Please prepare this amount in cash for your rider.'
          : 'This updates to the exact amount once your rider has bought your items and saved the receipt.'}
      </p>
    </div>
  );
}

/**
 * "Can you also grab something from the other store?" — asked properly.
 *
 * The rider has to agree (it's their extra trip), and accepting bills one more
 * store fee, so the operator earns commission on the added work instead of it
 * happening off the books in the chat.
 */
function AddonPanel({ delivery, storeFee }: { delivery: ActiveDelivery; storeFee: number }) {
  const [addons, setAddons] = useState<OrderAddon[]>([]);
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [store, setStore] = useState('');
  const [est, setEst] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try { setAddons(await listOrderAddons(supabase, delivery.id)); } catch { /* ignore */ }
  }, [delivery.id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const pending = addons.find((a) => a.status === 'pending');
  const accepted = addons.filter((a) => a.status === 'accepted');

  async function submit() {
    if (!supabase || !desc.trim()) return;
    setBusy(true); setErr(null);
    try {
      await requestOrderAddon(supabase, delivery.id, {
        description: desc.trim(),
        storeName: store.trim() || undefined,
        estimate: Number(est) > 0 ? Number(est) : 0,
      });
      setDesc(''); setStore(''); setEst(''); setOpen(false);
      await load();
    } catch (e) { setErr(errMessage(e)); }
    finally { setBusy(false); }
  }
  async function withdraw(id: string) {
    if (!supabase) return;
    setBusy(true); setErr(null);
    try { await cancelOrderAddon(supabase, id); await load(); }
    catch (e) { setErr(errMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h3 className="mb-2 font-bold">➕ Need something else?</h3>

      {accepted.map((a) => (
        <div key={a.id} className="mb-2 rounded-lg bg-green-50 px-3 py-2 ring-1 ring-green-200">
          <p className="text-sm font-medium text-green-800">✅ {a.description}</p>
          <p className="text-[11px] text-green-800/70">
            {a.store_name ? `${a.store_name} · ` : ''}added to your order
            {a.store_fee > 0 ? ` · +${peso(a.store_fee)} stop fee` : ''}
          </p>
        </div>
      ))}

      {pending ? (
        <div className="rounded-lg bg-brand-yellow/20 p-3 ring-1 ring-brand-yellow/50">
          <p className="text-sm font-medium text-brand-ink">⏳ Waiting for your rider to confirm</p>
          <p className="mt-0.5 text-sm">{pending.description}</p>
          {pending.store_name && <p className="text-[11px] text-black/50">at {pending.store_name}</p>}
          <button onClick={() => void withdraw(pending.id)} disabled={busy}
            className="mt-2 rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-black/60 disabled:opacity-50">
            Withdraw request
          </button>
        </div>
      ) : open ? (
        <div className="space-y-2">
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
            placeholder="e.g. 1kg sugar and a loaf of bread"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green" />
          <div className="flex gap-2">
            <input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Which store? (optional)"
              className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm" />
            <input type="number" inputMode="decimal" min={0} value={est} onChange={(e) => setEst(e.target.value)}
              placeholder="Est. ₱" className="w-24 shrink-0 rounded-lg border border-black/10 px-3 py-2 text-sm" />
          </div>
          <p className="text-[11px] text-black/50">
            An extra stop adds a {peso(storeFee)} fee on top of the goods. Your rider has to accept it first.
          </p>
          <div className="flex gap-2">
            <button onClick={() => void submit()} disabled={busy || !desc.trim()}
              className="flex-1 rounded-lg bg-brand-green py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Ask my rider'}
            </button>
            <button onClick={() => { setOpen(false); setErr(null); }}
              className="rounded-lg border border-black/15 px-3 text-sm font-medium text-black/60">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-brand-purple/40 py-2.5 text-sm font-semibold text-brand-purple">
          Ask your rider to buy from another store
        </button>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Demo route for preview mode (no backend).
const DEMO_PICKUP = { lat: 14.170, lng: 121.240 };
const DEMO_DROPOFF = { lat: 14.186, lng: 121.256 };

/** What each step of an operator-carried order is called, to the customer. */
const STEP_LABEL: Record<string, string> = {
  pending: 'Placed',
  accepted: 'Confirmed',
  preparing: 'Being prepared',
  picked_up: 'Loaded',
  on_the_way: 'On the way',
  delivered: 'Delivered',
};

/**
 * An order the shop is carrying itself, or one the customer is collecting.
 *
 * No rider means no live location, so this shows the two things that are
 * actually known: what has the order, and how far along it is. Previously the
 * customer got neither — the Track tab looked for an order with a rider on it,
 * found none, and said nothing was in progress while a kuliglig was en route.
 */
function CarrierPanel({ delivery, onClose }: { delivery: ActiveDelivery; onClose: () => void }) {
  const carrier = delivery.carrier!;
  const pickup = carrier.kind === 'pickup';
  const flow = operatorFlow(pickup ? 'pickup' : 'delivery', delivery.service_type)
    .filter((s) => s !== 'pending');
  const at = flow.indexOf(delivery.status);

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <h2 className="font-bold">{pickup ? 'Your collection' : 'Your delivery'}</h2>
        <button onClick={onClose} className="text-sm text-brand-purple">Close</button>
      </div>

      <div className="flex items-center gap-3 px-4 py-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand-green/10 text-2xl ring-1 ring-black/5">
          {pickup ? '🏪' : carrier.image
            ? <img src={carrier.image} alt="" className="h-full w-full object-cover" />
            : '🚚'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-black">
            {pickup ? 'You’re collecting this' : carrier.name}
          </p>
          <p className="text-sm text-black/55">{orderStatusLabel(delivery.status, carrier)}</p>
          {!pickup && delivery.delivery_fee > 0 && (
            <p className="text-xs text-black/45">Delivery fee {peso(delivery.delivery_fee)}</p>
          )}
        </div>
      </div>

      {/* Where it has got to. One line, because there is no map to draw. */}
      <ol className="space-y-0 border-t border-black/5 px-4 py-3">
        {flow.map((s, i) => {
          const done = at >= 0 && i <= at;
          const now = i === at;
          return (
            <li key={s} className="flex items-center gap-3 py-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                done ? 'bg-brand-green text-white' : 'bg-black/[0.07] text-black/35'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-sm ${now ? 'font-bold text-brand-ink' : done ? 'text-black/55' : 'text-black/35'}`}>
                {pickup && s === 'delivered' ? 'Collected' : STEP_LABEL[s] ?? s}
              </span>
            </li>
          );
        })}
      </ol>

      {pickup
        ? (
          <p className="border-t border-black/5 bg-brand-yellow/10 px-4 py-3 text-xs text-black/55">
            We’ll message you here the moment it’s ready. Bring your order number.
          </p>
        ) : (
          <p className="border-t border-black/5 bg-black/[0.02] px-4 py-3 text-xs text-black/50">
            {delivery.delivery_address
              ? <>Going to <span className="font-medium text-black/70">{delivery.delivery_address}</span>.</>
              : 'Going to your saved address.'}
            {' '}There’s no live map for our own vehicles — message us below if you need it sooner.
          </p>
        )}
    </div>
  );
}

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
  const [storeFee, setStoreFee] = useState(0);
  useArrivalAlert(delivery?.arrived_at, riderInfo?.name);

  useEffect(() => {
    if (!supabase) return;
    getAppSettings(supabase).then((s) => setStoreFee(Number(s.per_store_fee ?? 0))).catch(() => {});
  }, []);

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

  // The operator is carrying this one. There is no rider pinging a location, so
  // a map would be a still picture pretending to be live. The honest thing to
  // show is what has it and how far along it is.
  if (delivery?.carrier) {
    return (
      <div className="space-y-3">
        <CarrierPanel delivery={delivery} onClose={onClose} />
        <ChatButton orderId={delivery.id} role="customer" title="Chat with the shop" />
        <OrderItemsCard delivery={delivery} onChange={() => void load()} />
        {delivery.payment_method === 'rider_qr' && <PayRider orderId={delivery.id} />}
        {delivery.payment_method === 'cod' && <PayOnDelivery delivery={delivery} />}
      </div>
    );
  }

  if (status === 'ok' && delivery?.pickup && delivery.dropoff) {
    return (
      <div className="space-y-3">
        <ArrivalBanner arrivedAt={delivery.arrived_at} riderName={riderInfo?.name} />
        <NotificationOptIn show={!delivery.arrived_at} />
        <TrackingMap pickup={delivery.pickup} dropoff={delivery.dropoff} orderId={delivery.id}
          deliveryStatus={delivery.status} courier={riderInfo} onClose={onClose} />
        <ChatButton orderId={delivery.id} role="customer" title="Chat with your rider" />
        <OrderItemsCard delivery={delivery} onChange={() => void load()} />
        {delivery.payment_method === 'rider_qr' && <PayRider orderId={delivery.id} />}
        {delivery.payment_method === 'cod' && <PayOnDelivery delivery={delivery} />}
        {delivery.service_type === 'pabili' && <AddonPanel delivery={delivery} storeFee={storeFee} />}
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
      {delivery && <ArrivalBanner arrivedAt={delivery.arrived_at} riderName={riderInfo?.name} />}
      {delivery && <OrderItemsCard delivery={delivery} onChange={() => void load()} />}
      {delivery?.payment_method === 'rider_qr' && <PayRider orderId={delivery.id} />}
      {delivery?.payment_method === 'cod' && <PayOnDelivery delivery={delivery} />}
      {delivery?.service_type === 'pabili' && <AddonPanel delivery={delivery} storeFee={storeFee} />}
    </div>
  );
}
