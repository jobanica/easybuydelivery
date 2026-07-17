import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ORDER_FLOW,
  isLockedOut,
  overdueBalance,
  owedBalance,
  pabiliCollectible,
  type LedgerEntry,
  type OrderStatus,
} from '@ebd/shared';
import { makeRiderData, type RiderData, type RiderOrder } from './data/index.ts';
import { peso } from './ui.tsx';
import { Qr } from './Qr.tsx';
import { useLocationPublisher } from './useLocationPublisher.ts';

const today = new Date().toISOString().slice(0, 10);

export function App() {
  const [data] = useState<RiderData>(() => makeRiderData());
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [open, setOpen] = useState<RiderOrder[]>([]);
  const [active, setActive] = useState<RiderOrder[]>([]);
  const [tab, setTab] = useState<'available' | 'active'>('available');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, o, a] = await Promise.all([data.getLedger(), data.getOpenOrders(), data.getActiveOrders()]);
      setLedger(l); setOpen(o); setActive(a); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [data]);

  useEffect(() => { void refresh(); }, [refresh]);

  const locked = isLockedOut(ledger, today);
  const overdue = overdueBalance(ledger, today);

  async function settleNow() {
    const day = ledger.find((e) => !e.settled && e.businessDay < today)?.businessDay;
    if (!day) return;
    await data.settle(day, overdue);
    await refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="bg-brand-purple text-white">
        <div className="mx-auto max-w-lg px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Easy Buy Delivery — Rider</h1>
            <p className="text-xs opacity-90">{data.live ? 'Live' : 'Preview mode'}</p>
          </div>
          <BalancePill owed={owedBalance(ledger)} />
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-5">
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {locked ? (
          <LockScreen overdue={overdue} onSettle={settleNow} />
        ) : (
          <>
            <nav className="mb-4 flex gap-2">
              <Tab active={tab === 'available'} onClick={() => setTab('available')}>
                Available ({open.length})
              </Tab>
              <Tab active={tab === 'active'} onClick={() => setTab('active')}>
                My deliveries ({active.length})
              </Tab>
            </nav>

            {tab === 'available' ? (
              open.length === 0
                ? <Empty>No orders in the pool right now.</Empty>
                : open.map((o) => (
                    <PoolCard key={o.id} order={o}
                      onAccept={async () => { await data.accept(o.id); setTab('active'); await refresh(); }} />
                  ))
            ) : (
              active.length === 0
                ? <Empty>No active deliveries. Accept one from the pool.</Empty>
                : active.map((o) => (
                    <ActiveCard key={o.id} order={o} data={data} onChange={refresh} />
                  ))
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LockScreen({ overdue, onSettle }: { overdue: number; onSettle: () => void }) {
  return (
    <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">🔒</div>
      <h2 className="text-lg font-bold">Account locked</h2>
      <p className="mt-1 text-sm text-black/60">
        Settle yesterday's commission balance to accept new orders.
      </p>
      <p className="my-4 text-3xl font-bold text-brand-purple">{peso(overdue)}</p>
      <p className="text-xs text-black/50">
        Pay via GCash/Maya to the operator, then confirm below. (In production the
        admin marks it paid.)
      </p>
      <button onClick={onSettle}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white">
        Settle {peso(overdue)} to continue
      </button>
    </div>
  );
}

/** The next forward status for an order, or null if terminal. */
function nextStatus(order: RiderOrder): OrderStatus | null {
  const flow = ORDER_FLOW[order.service_type];
  const i = flow.indexOf(order.status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1]! : null;
}

const STATUS_ACTION: Record<OrderStatus, string> = {
  pending: 'Accept',
  accepted: 'Accepted',
  preparing: 'Mark preparing',
  picked_up: 'Picked up',
  on_the_way: 'On the way',
  delivered: 'Delivered & collected',
  cancelled: 'Cancelled',
};

function amountToCollect(o: RiderOrder): number | null {
  // Fees prepaid online → rider collects only the goods they fronted.
  if (o.payment_method === 'online') {
    if (o.service_type === 'pabili') return o.actual_amount; // null until bought
    return o.goods_cost; // food goods; 0 for padala
  }
  // Paid to the rider via QR → nothing collected at the door.
  if (o.payment_method === 'rider_qr') return 0;
  // Cash on delivery.
  if (o.service_type === 'padala') return o.delivery_fee;
  if (o.service_type === 'pabili') {
    if (o.actual_amount == null) return null; // unknown until bought
    return pabiliCollectible(o.actual_amount, o.delivery_fee);
  }
  return o.goods_cost + o.delivery_fee; // food
}

function PoolCard({ order, onAccept }: { order: RiderOrder; onAccept: () => void }) {
  return (
    <div className="mb-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <CardHead order={order} />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-black/60">Earn {peso(order.commission_amount)} commission</span>
        <button onClick={onAccept}
          className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">
          Accept
        </button>
      </div>
    </div>
  );
}

function ActiveCard({ order, data, onChange }:
  { order: RiderOrder; data: RiderData; onChange: () => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const next = nextStatus(order);
  const collect = amountToCollect(order);
  const needsActual = order.service_type === 'pabili' && order.actual_amount == null;

  // Share GPS to the customer's map while in transit (live mode only).
  useLocationPublisher(order.id, order.status);

  async function saveActual() {
    const val = Number(amount);
    if (!Number.isFinite(val) || val < 0) return;
    const res = await data.setActual(order, val);
    setNote(res.overCap ? 'Over the cap — confirm with the customer before collecting.' : null);
    await onChange();
  }

  return (
    <div className="mb-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <CardHead order={order} />

      {order.store_contact && (
        <a href={`tel:${order.store_contact}`}
          className="mt-2 inline-block text-sm text-brand-purple">📞 Call store {order.store_contact}</a>
      )}

      {needsActual && (
        <div className="mt-3 rounded-lg bg-brand-yellow/15 p-3">
          <p className="mb-1 text-xs font-medium">Enter the receipt total (cap {peso(order.budget_cap ?? 0)})</p>
          <div className="flex gap-2">
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="Actual ₱" />
            <button onClick={saveActual}
              className="rounded-lg bg-brand-purple px-3 py-2 text-sm font-medium text-white">Save</button>
          </div>
        </div>
      )}

      {note && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">⚠️ {note}</p>
      )}

      {/* At drop-off, show the rider QR for unpaid COD orders so the customer
          can pay online instead of cash. */}
      {order.payment_status !== 'paid' && order.status === 'on_the_way' && (
        <div className="mt-3 flex flex-col items-center rounded-lg bg-black/[0.02] p-3">
          <p className="mb-2 text-xs font-medium text-black/60">Or let the customer scan to pay</p>
          <Qr payload={`ebd://pay?order=${order.id}&amount=${collect ?? 0}`} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-3">
        <span className="text-sm">
          {order.payment_status === 'paid'
            ? <span className="text-green-700">✓ Paid online{collect ? ` · collect ${peso(collect)} goods` : ' · nothing to collect'}</span>
            : collect == null
              ? <span className="text-black/50">Collect: enter actual first</span>
              : <>Collect <span className="font-bold">{peso(collect)}</span></>}
        </span>
        {next && (
          <button
            disabled={next === 'delivered' && needsActual}
            onClick={async () => { await data.advance(order, next); await onChange(); }}
            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {STATUS_ACTION[next]}
          </button>
        )}
      </div>
    </div>
  );
}

function CardHead({ order }: { order: RiderOrder }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-xs font-semibold capitalize text-green-800">
          {order.service_type}
        </span>
        <p className="mt-1 text-sm font-medium">
          {order.item_description ?? (order.service_type === 'food' ? 'Food order' : '—')}
        </p>
        <a href={`tel:${order.customer_contact}`} className="text-xs text-brand-purple">
          📞 {order.customer_contact}
        </a>
      </div>
      <div className="text-right">
        <span className="block text-xs capitalize text-black/50">{order.status.replace('_', ' ')}</span>
        {order.payment_status === 'paid' && (
          <span className="mt-1 inline-block rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-semibold text-green-800">
            PAID online
          </span>
        )}
      </div>
    </div>
  );
}

function BalancePill({ owed }: { owed: number }) {
  return (
    <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
      Owed: {peso(owed)}
    </span>
  );
}

function Tab({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-brand-green text-white' : 'bg-white text-black/60 ring-1 ring-black/10'
      }`}>
      {children}
    </button>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) =>
  <p className="rounded-xl bg-white p-6 text-center text-sm text-black/50 shadow-sm ring-1 ring-black/5">{children}</p>;
