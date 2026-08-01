import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ORDER_FLOW,
  isLockedOut,
  overdueBalance,
  owedBalance,
  pabiliCollectible,
  riderEarnings,
  type LedgerEntry,
  type OrderStatus,
} from '@ebd/shared';
import {
  subscribeToNewOrders, signOut,
  getRiderProfile, updateRiderProfile, uploadRiderPhoto, type RiderProfile,
  getAppSettings, uploadSettlementReceipt, type AppSettings,
} from '@ebd/supabase';
import { makeRiderData, type RiderData, type RiderOrder } from './data/index.ts';
import { peso } from './ui.tsx';
import { Qr } from './Qr.tsx';
import { DeliveryMap } from './DeliveryMap.tsx';
import { useLocationPublisher } from './useLocationPublisher.ts';
import { ChatButton } from './Chat.tsx';
import { usePushRegistration } from './usePushRegistration.ts';
import { supabase } from './lib/supabase.ts';
import { SUPPORT_CONTACT, APP_VERSION, TERMS_URL } from './config.ts';

const SERVICES: { key: string; label: string }[] = [
  { key: 'food', label: 'Food' }, { key: 'pabili', label: 'Pabili' }, { key: 'padala', label: 'Padala' },
];

// Philippine business day (matches the commission_ledger trigger), so the
// daily settlement gate and the recorded commission agree on "today".
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
type Tab = 'dashboard' | 'requests' | 'deliveries' | 'earnings' | 'settings';

export function App({ riderId, riderName }: { riderId?: string; riderName?: string } = {}) {
  const [data] = useState<RiderData>(() => makeRiderData(riderId));
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [open, setOpen] = useState<RiderOrder[]>([]);
  const [active, setActive] = useState<RiderOrder[]>([]);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<RiderProfile | null>(null);

  const loadProfile = useCallback(async () => {
    if (!supabase || !riderId) return;
    try { setProfile(await getRiderProfile(supabase, riderId)); } catch { /* non-fatal */ }
  }, [riderId]);
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const refresh = useCallback(async () => {
    try {
      const [l, o, a] = await Promise.all([data.getLedger(), data.getOpenOrders(), data.getActiveOrders()]);
      setLedger(l); setOpen(o); setActive(a); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [data]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { data.getOnline().then(setOnline).catch(() => {}); }, [data]);
  usePushRegistration(riderId, profile?.push_enabled ?? true);

  useEffect(() => {
    if (!supabase) return;
    return subscribeToNewOrders(supabase, () => void refresh());
  }, [refresh]);

  const locked = isLockedOut(ledger, today);
  const overdue = overdueBalance(ledger, today);
  const owed = owedBalance(ledger);
  const accepts = (t: string) => !profile?.services_accepted || profile.services_accepted.includes(t);
  // Transfers first — a released delivery may already have paid-for goods
  // waiting, so it should be taken before brand-new orders.
  const pool = open
    .filter((o) => !declined.has(o.id) && accepts(o.service_type))
    .sort((a, b) => Number(b.isTransfer) - Number(a.isTransfer));
  const transfers = pool.filter((o) => o.isTransfer);
  const newRequests = pool.filter((o) => !o.isTransfer);

  async function toggleOnline() {
    setOnlineBusy(true);
    try { setOnline(await data.setOnline(!online)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setOnlineBusy(false); }
  }

  async function accept(orderId: string) {
    try { await data.accept(orderId); setTab('deliveries'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    await refresh();
  }

  async function submitSettlement(extra?: { reference?: string; receiptUrl?: string }) {
    // Settle the full owed balance: use the latest unsettled day (today's total
    // included) — confirmSettlement clears everything up to it.
    const unsettledDays = ledger.filter((e) => !e.settled).map((e) => e.businessDay).sort();
    const day = unsettledDays[unsettledDays.length - 1];
    if (!day) return;
    await data.settle(day, owed, extra);
    await refresh();
  }

  const firstName = ((profile?.name ?? riderName) ?? '').trim().split(/\s+/)[0] || 'Rider';

  return (
    <div className="min-h-screen bg-[#f6f7f4] pb-24">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand-green/15 text-lg">
              {profile?.photo_url ? <img src={profile.photo_url} alt="" className="h-full w-full object-cover" /> : '🛵'}
            </span>
            <div className="leading-tight">
              <p className="text-xs text-black/45">Welcome back!</p>
              <h1 className="text-base font-extrabold">{firstName}</h1>
            </div>
          </div>
          <button onClick={() => setTab('requests')}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04]">
            <BellIcon />
            {online && pool.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-purple px-1 text-[10px] font-bold text-white">
                {pool.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-4">
        {error && <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {tab === 'dashboard' && (
          <Dashboard
            online={online} onlineBusy={onlineBusy} onToggleOnline={toggleOnline}
            pool={pool} active={active} owed={owed} locked={locked}
            onGo={setTab} onAccept={accept} data={data} onChange={refresh} />
        )}

        {tab === 'requests' && (
          locked ? <LockCard overdue={overdue} onSettle={() => setTab('earnings')} />
            : !online ? <OfflineCard onGoOnline={toggleOnline} busy={onlineBusy} />
            : pool.length === 0 ? <Empty icon="📭">No requests in the pool right now.</Empty>
            : <div className="space-y-5">
                {transfers.length > 0 && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-brand-yellow/20 px-4 py-3 ring-1 ring-brand-yellow">
                      <h2 className="text-lg font-extrabold text-yellow-900">🔄 Transfer deliveries</h2>
                      <p className="text-xs text-yellow-900/80">
                        Released by another rider — please take these first.
                      </p>
                    </div>
                    {transfers.map((o) => (
                      <RequestCard key={o.id} order={o}
                        onAccept={() => accept(o.id)}
                        onDecline={() => setDeclined((d) => new Set(d).add(o.id))} />
                    ))}
                  </div>
                )}
                {newRequests.length > 0 && (
                  <div className="space-y-3">
                    <SectionTitle>Available requests</SectionTitle>
                    {newRequests.map((o) => (
                      <RequestCard key={o.id} order={o}
                        onAccept={() => accept(o.id)}
                        onDecline={() => setDeclined((d) => new Set(d).add(o.id))} />
                    ))}
                  </div>
                )}
              </div>
        )}

        {tab === 'deliveries' && (
          active.length === 0
            ? <Empty icon="✅">No active deliveries. Accept one from Requests.</Empty>
            : <div className="space-y-4">
                <SectionTitle>My deliveries</SectionTitle>
                {active.map((o) => <DeliveryCard key={o.id} order={o} data={data} onChange={refresh} payoutNumber={profile?.payout_number} />)}
              </div>
        )}

        {tab === 'earnings' && <EarningsView live={data.live} ledger={ledger} owed={owed} overdue={overdue} onSettle={submitSettlement} />}

        {tab === 'settings' && (
          <SettingsView live={data.live} online={online} busy={onlineBusy} onToggleOnline={toggleOnline}
            profile={profile} onProfileSaved={loadProfile} />
        )}
      </main>

      <BottomNav tab={tab} onTab={setTab} requests={online ? pool.length : 0} deliveries={active.length} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({ online, onlineBusy, onToggleOnline, pool, active, owed, locked, onGo, onAccept, data, onChange }: {
  online: boolean; onlineBusy: boolean; onToggleOnline: () => void;
  pool: RiderOrder[]; active: RiderOrder[]; owed: number; locked: boolean;
  onGo: (t: Tab) => void; onAccept: (id: string) => void; data: RiderData; onChange: () => Promise<void>;
}) {
  const todaysPotential = active.reduce((s, o) => s + riderEarn(o), 0);
  const transferCount = pool.filter((o) => o.isTransfer).length;
  return (
    <div className="space-y-4">
      <OnlineToggle online={online} busy={onlineBusy} onToggle={onToggleOnline} />

      {/* Transfers need a taker first — surface them above everything else. */}
      {online && !locked && transferCount > 0 && (
        <button onClick={() => onGo('requests')}
          className="flex w-full items-center justify-between rounded-2xl bg-brand-yellow/25 px-4 py-3 text-left ring-1 ring-brand-yellow">
          <span>
            <span className="block text-sm font-extrabold text-yellow-900">
              🔄 {transferCount} transfer {transferCount === 1 ? 'delivery' : 'deliveries'} waiting
            </span>
            <span className="text-xs text-yellow-900/80">Released by another rider — take these first</span>
          </span>
          <span className="shrink-0 rounded-lg bg-yellow-900 px-3 py-1.5 text-xs font-bold text-white">View</span>
        </button>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="In the pool" value={String(pool.length)} tint="green"
          hint={online ? 'Tap to view' : 'Go online to see'} onClick={() => onGo('requests')} icon={<InboxIcon />} />
        <StatCard label="My deliveries" value={String(active.length)} tint="purple"
          hint="In progress" onClick={() => onGo('deliveries')} icon={<BoxIcon />} />
      </div>

      {/* Owed / earnings */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <p className="text-xs text-black/45">On your plate</p>
          <p className="mt-1 text-2xl font-black text-brand-ink">{peso(todaysPotential)}</p>
          <p className="text-[11px] text-black/40">Earnings from active deliveries</p>
        </div>
        <button onClick={() => onGo('earnings')}
          className={`rounded-2xl p-4 text-left shadow-sm ring-1 ${owed > 0 ? 'bg-brand-yellow/20 ring-brand-yellow/40' : 'bg-white ring-black/5'}`}>
          <p className="text-xs text-black/45">Commission owed</p>
          <p className={`mt-1 text-2xl font-black ${owed > 0 ? 'text-yellow-800' : 'text-brand-ink'}`}>{peso(owed)}</p>
          <p className="text-[11px] text-black/40">{owed > 0 ? 'Tap to settle' : 'All settled'}</p>
        </button>
      </div>

      {locked && <LockCard overdue={owed} onSettle={async () => onGo('earnings')} compact />}

      {/* Next up */}
      {active.length > 0 ? (
        <div>
          <SectionTitle>Continue delivery</SectionTitle>
          <DeliveryCard order={active[0]!} data={data} onChange={onChange} />
        </div>
      ) : online && !locked && pool.length > 0 ? (
        <div>
          <SectionTitle>{pool[0]!.isTransfer ? 'Transfer delivery' : 'New request'}</SectionTitle>
          <RequestCard order={pool[0]!} onAccept={() => onAccept(pool[0]!.id)} onDecline={() => onGo('requests')} declineLabel="See all" />
        </div>
      ) : (
        <Empty icon={online ? '📭' : '😴'}>
          {online ? 'No requests yet — new orders appear here.' : "You're offline. Go online to receive orders."}
        </Empty>
      )}
    </div>
  );
}

function StatCard({ label, value, hint, tint, icon, onClick }: {
  label: string; value: string; hint: string; tint: 'green' | 'purple'; icon: React.ReactNode; onClick: () => void;
}) {
  const tintCls = tint === 'green' ? 'bg-brand-green/15 text-green-800' : 'bg-brand-purple/15 text-brand-purple';
  return (
    <button onClick={onClick} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-full ${tintCls}`}>{icon}</span>
        <span className="text-3xl font-black text-brand-ink">{value}</span>
      </div>
      <p className="mt-2 text-sm font-semibold">{label}</p>
      <p className="text-[11px] text-black/40">{hint}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Request (pool) card
// ---------------------------------------------------------------------------

function riderEarn(o: RiderOrder): number {
  return riderEarnings({
    deliveryFee: o.delivery_fee, storeFeeTotal: o.store_fee_total,
    convenienceFee: o.convenience_fee, commission: o.commission_amount,
  });
}

const serviceTint: Record<string, string> = {
  food: 'bg-brand-green/15 text-green-800',
  pabili: 'bg-brand-purple/15 text-brand-purple',
  padala: 'bg-brand-yellow/30 text-yellow-800',
};

/**
 * Order items grouped by store: each restaurant shows its name + phone, with its
 * items listed underneath — so a multi-store order is clear at a glance.
 */
function StoreGroups({ order }: { order: RiderOrder }) {
  const byStore = new Map<string, RiderOrder['items']>();
  const noStore: RiderOrder['items'] = [];
  for (const it of order.items) {
    if (it.store_id) byStore.set(it.store_id, [...(byStore.get(it.store_id) ?? []), it]);
    else noStore.push(it);
  }

  const ItemRow = (it: RiderOrder['items'][number], j: number) => (
    <li key={j} className="flex justify-between gap-2">
      <span className="min-w-0">
        <span className="font-medium">{it.qty}×</span> {it.name}
        {it.notes && <span className="block text-xs text-black/45">— {it.notes}</span>}
      </span>
      {it.unitPrice > 0 && <span className="shrink-0 text-black/50">{peso(it.unitPrice * it.qty)}</span>}
    </li>
  );

  if (order.stores.length === 0 && noStore.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {order.stores.map((s, i) => {
        const items = (s.id && byStore.get(s.id)) || [];
        return (
          <div key={s.id ?? i} className="rounded-xl bg-brand-purple/[0.06] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-bold">{s.name ?? 'Store'}</p>
              {s.contact
                ? <a href={`tel:${s.contact}`} aria-label={`Call ${s.name ?? 'store'}`}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-purple"><PhoneIcon /> {s.contact}</a>
                : <span className="shrink-0 text-[11px] text-black/40">No number</span>}
            </div>
            {items.length > 0 && <ul className="mt-2 space-y-1 text-sm">{items.map(ItemRow)}</ul>}
          </div>
        );
      })}
      {noStore.length > 0 && (
        <div className="rounded-xl bg-black/[0.03] p-3">
          <p className="mb-1.5 text-xs font-semibold text-black/60">Order</p>
          <ul className="space-y-1 text-sm">{noStore.map(ItemRow)}</ul>
        </div>
      )}
    </div>
  );
}

function RequestCard({ order, onAccept, onDecline, declineLabel = 'Decline' }: {
  order: RiderOrder; onAccept: () => void; onDecline: () => void; declineLabel?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${order.isTransfer ? 'ring-2 ring-brand-yellow' : 'ring-black/5'}`}>
      {order.isTransfer && (
        <div className="bg-brand-yellow/30 px-4 py-2">
          <p className="text-xs font-bold text-yellow-900">
            🔄 Transfer — released by {order.transferredFromName ?? 'another rider'}
            {order.transferReason ? ` · ${order.transferReason}` : ''}
          </p>
          {order.transferHadGoods && (
            <p className="mt-0.5 text-[11px] text-yellow-900/80">
              ⚠️ Items already picked up — coordinate the hand-over
              {order.transferredFromContact ? ` (${order.transferredFromContact})` : ''}.
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between px-4 pt-4">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${serviceTint[order.service_type] ?? 'bg-black/5'}`}>
          {order.service_type}
        </span>
        <span className="rounded-full bg-brand-ink px-2.5 py-1 text-xs font-bold text-white">{peso(riderEarn(order))}</span>
      </div>
      <div className="px-4 py-3">
        {order.isTransfer && order.transferHadGoods && order.transferredFromContact && (
          <a href={`tel:${order.transferredFromContact}`}
            className="mb-2 inline-flex items-center gap-1 rounded-lg bg-brand-purple/10 px-2.5 py-1 text-xs font-semibold text-brand-purple">
            <PhoneIcon /> Call {order.transferredFromName ?? 'previous rider'}
          </a>
        )}
        <p className="text-sm font-semibold">
          {order.item_description ?? (order.service_type === 'food' ? 'Food order' : 'Delivery')}
        </p>
        <a href={`tel:${order.customer_contact}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-purple">
          <PhoneIcon /> {order.customer_contact}
        </a>
        <StoreGroups order={order} />
        {order.notes && (
          <p className="mt-2 rounded-lg bg-brand-yellow/20 px-2.5 py-1.5 text-xs text-yellow-900">📝 {order.notes}</p>
        )}
        <p className="mt-2 text-xs text-black/45">
          You earn <span className="font-bold text-green-700">{peso(riderEarn(order))}</span>
          <span className="text-black/35"> · after {peso(order.commission_amount)} commission</span>
        </p>
      </div>
      <div className="flex gap-2 border-t border-black/5 p-3">
        <button onClick={onDecline}
          className="flex-1 rounded-xl border border-black/10 py-2.5 text-sm font-semibold text-black/60 hover:bg-black/[0.03]">
          {declineLabel}
        </button>
        <button onClick={onAccept}
          className="flex-1 rounded-xl bg-brand-green py-2.5 text-sm font-bold text-white hover:brightness-95">
          Accept
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active delivery card
// ---------------------------------------------------------------------------

function nextStatus(order: RiderOrder): OrderStatus | null {
  const flow = ORDER_FLOW[order.service_type];
  const i = flow.indexOf(order.status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1]! : null;
}

const STATUS_ACTION: Record<OrderStatus, string> = {
  pending: 'Accept', accepted: 'Accepted', preparing: 'Mark preparing',
  picked_up: 'Picked up', on_the_way: 'On the way',
  delivered: 'Mark as completed', cancelled: 'Cancelled',
};

/** The full customer total (what COD collects / what a GCash-to-rider QR charges). */
function fullCollectible(o: RiderOrder): number | null {
  if (o.service_type === 'padala') return o.delivery_fee;
  if (o.service_type === 'pabili') {
    if (o.actual_amount == null) return null;
    return pabiliCollectible(o.actual_amount, o.delivery_fee, o.convenience_fee);
  }
  // Food: goods + delivery + store + convenience.
  return o.goods_cost + o.delivery_fee + o.store_fee_total + o.convenience_fee;
}

function amountToCollect(o: RiderOrder): number | null {
  if (o.payment_method === 'online') {
    if (o.service_type === 'pabili') return o.actual_amount;
    return o.goods_cost;
  }
  // Paid to the rider via GCash QR — no cash to collect at the door.
  if (o.payment_method === 'rider_qr') return 0;
  return fullCollectible(o);
}

function DeliveryCard({ order, data, onChange, payoutNumber }:
  { order: RiderOrder; data: RiderData; onChange: () => Promise<void>; payoutNumber?: string | null }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseErr, setReleaseErr] = useState<string | null>(null);
  const next = nextStatus(order);
  const collect = amountToCollect(order);
  const isRiderQr = order.payment_method === 'rider_qr';
  // Amount encoded in the scan-to-pay QR: for GCash-to-rider, the full total.
  const qrAmount = isRiderQr ? fullCollectible(order) : collect;
  const needsActual = order.service_type === 'pabili' && order.actual_amount == null;

  useLocationPublisher(order.id, order.status);

  async function saveActual() {
    const val = Number(amount);
    if (!Number.isFinite(val) || val < 0) return;
    const res = await data.setActual(order, val);
    setNote(res.overCap ? 'Over the cap — confirm with the customer before collecting.' : null);
    await onChange();
  }

  const hasGoods = order.status === 'picked_up' || order.status === 'on_the_way';

  async function release() {
    const msg = hasGoods
      ? "You've already picked up the items for this order. Transfer it? It goes to the top of the pool as a transfer delivery, and you'll coordinate handing the items over to the rider who takes it.\n\nWhy can't you continue? (shown to the next rider)"
      : "Transfer this delivery back to the pool? It's prioritised so another rider takes it first.\n\nWhy can't you continue? (shown to the next rider)";
    const reason = window.prompt(msg, 'Breakdown');
    if (reason === null) return; // cancelled
    setReleasing(true); setReleaseErr(null);
    try { await data.releaseOrder(order.id, reason.trim() || undefined); await onChange(); }
    catch (e) { setReleaseErr(e instanceof Error ? e.message : String(e)); setReleasing(false); }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      {/* Status banner */}
      <div className="flex items-center justify-between bg-brand-green/10 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-bold text-green-800">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand-green" />
          {order.status.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${serviceTint[order.service_type] ?? 'bg-black/5'}`}>
          {order.service_type}
        </span>
      </div>

      <div className="p-4">
        <p className="text-sm font-semibold">
          {order.item_description ?? (order.service_type === 'food' ? 'Food order' : 'Delivery')}
        </p>

        {/* Live tracking map + navigation */}
        {(order.deliveryLat != null || order.pickupLat != null || order.stores.some((s) => s.lat != null)) && (
          <div className="mt-3">
            <DeliveryMap
              dropoff={order.deliveryLat != null && order.deliveryLng != null ? { lat: order.deliveryLat, lng: order.deliveryLng } : null}
              stores={
                order.stores.some((s) => s.lat != null) || order.pickupLat == null || order.pickupLng == null
                  ? order.stores
                  // Pabili/Padala have no store row — show the customer's pickup pin instead.
                  : [{ id: null, name: order.service_type === 'padala' ? 'Pickup' : 'Buy here',
                       contact: null, lat: order.pickupLat, lng: order.pickupLng }]
              } />
            <div className="mt-2 flex gap-2">
              {order.pickupLat != null && order.pickupLng != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${order.pickupLat},${order.pickupLng}`}
                  target="_blank" rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-green py-2.5 text-sm font-bold text-white">
                  🧭 {order.service_type === 'padala' ? 'To pickup' : 'To store'}
                </a>
              )}
              {order.deliveryLat != null && order.deliveryLng != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLat},${order.deliveryLng}`}
                  target="_blank" rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-purple py-2.5 text-sm font-bold text-white">
                  🧭 To drop-off
                </a>
              )}
            </div>
          </div>
        )}

        {/* What the customer ordered */}
        {/* Fee breakdown — so the delivery fee is always visible */}
        <div className="mt-3 space-y-1 rounded-xl bg-black/[0.03] p-3 text-sm">
          {order.goods_cost > 0 && (
            <div className="flex justify-between text-black/60">
              <span>{order.service_type === 'food' ? 'Food subtotal' : 'Goods'}</span><span>{peso(order.goods_cost)}</span>
            </div>
          )}
          <div className="flex justify-between font-medium">
            <span>Delivery fee</span><span className="text-green-700">{peso(order.delivery_fee)}</span>
          </div>
          {order.store_fee_total > 0 && (
            <div className="flex justify-between text-black/60">
              <span>Store fee</span><span>{peso(order.store_fee_total)}</span>
            </div>
          )}
          {order.convenience_fee > 0 && (
            <div className="flex justify-between text-black/60">
              <span>Convenience fee</span><span>{peso(order.convenience_fee)}</span>
            </div>
          )}
        </div>

        {/* Deliver-to (recipient if a gift order) + contact. */}
        {order.recipientContact ? (
          <>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-black/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs text-black/45">🎁 Deliver to</p>
                <p className="truncate text-sm font-medium">{order.recipientName || order.recipientContact}</p>
                {order.recipientName && <p className="truncate text-xs text-black/45">{order.recipientContact}</p>}
              </div>
              <div className="flex gap-2">
                <a href={`tel:${order.recipientContact}`} aria-label="Call recipient"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-white"><PhoneIcon /></a>
                <a href={`sms:${order.recipientContact}`} aria-label="Message recipient"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-purple text-white"><ChatIcon /></a>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-black/[0.03] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-black/45">Sender (pays)</p>
                <p className="truncate text-sm font-medium">{order.customerName || order.customer_contact}</p>
              </div>
              <a href={`tel:${order.customer_contact}`} aria-label="Call sender"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-purple text-white"><PhoneIcon /></a>
            </div>
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-black/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs text-black/45">Customer</p>
              <p className="truncate text-sm font-medium">{order.customerName || order.customer_contact}</p>
              {order.customerName && <p className="truncate text-xs text-black/45">{order.customer_contact}</p>}
            </div>
            <div className="flex gap-2">
              <a href={`tel:${order.customer_contact}`} aria-label="Call customer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green text-white"><PhoneIcon /></a>
              <a href={`sms:${order.customer_contact}`} aria-label="Message customer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-purple text-white"><ChatIcon /></a>
            </div>
          </div>
        )}
        {/* Restaurant / store with its items grouped underneath. */}
        <StoreGroups order={order} />
        <div className="mt-2">
          <ChatButton orderId={order.id} role="rider"
            title={`Chat with ${order.recipientContact ? 'sender' : 'customer'}`}
            className="relative w-full rounded-xl bg-brand-purple py-2.5 text-sm font-bold text-white" />
        </div>
        {order.notes && (
          <p className="mt-2 rounded-lg bg-brand-yellow/20 px-2.5 py-1.5 text-xs text-yellow-900">📝 {order.notes}</p>
        )}

        {needsActual && (
          <div className="mt-3 rounded-xl bg-brand-yellow/15 p-3">
            <p className="mb-1 text-xs font-medium">Enter the receipt total (cap {peso(order.budget_cap ?? 0)})</p>
            <div className="flex gap-2">
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="Actual ₱" />
              <button onClick={saveActual} className="rounded-lg bg-brand-purple px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </div>
        )}
        {note && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">⚠️ {note}</p>}

        {order.payment_status !== 'paid' && order.status === 'on_the_way' && (
          <div className={`mt-3 flex flex-col items-center rounded-xl p-3 ${isRiderQr ? 'bg-brand-purple/[0.06] ring-1 ring-brand-purple/20' : 'bg-black/[0.02]'}`}>
            <p className="mb-2 text-xs font-medium text-black/60">
              {isRiderQr
                ? <>Customer pays by GCash — let them scan to send <span className="font-bold text-brand-ink">{qrAmount != null ? peso(qrAmount) : ''}</span></>
                : 'Let the customer scan to pay'}
            </p>
            <Qr payload={payoutNumber ? `ebd://pay?to=${encodeURIComponent(payoutNumber)}&amount=${qrAmount ?? 0}` : `ebd://pay?order=${order.id}&amount=${qrAmount ?? 0}`} />
            {payoutNumber
              ? <p className="mt-2 text-xs text-black/60">GCash/Maya: <span className="font-semibold text-brand-ink">{payoutNumber}</span></p>
              : <p className="mt-2 text-[11px] text-black/35">Set your GCash/Maya number in Settings</p>}
          </div>
        )}

        {/* Collect + advance */}
        <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-3">
          <span className="text-sm">
            {order.payment_status === 'paid'
              ? <span className="text-green-700">✓ Paid online{collect ? ` · collect ${peso(collect)} goods` : ' · nothing to collect'}</span>
              : isRiderQr
                ? <span className="text-brand-purple">GCash to rider{qrAmount != null ? ` · ${peso(qrAmount)}` : ''} — no cash to collect</span>
                : collect == null
                  ? <span className="text-black/50">Collect: enter actual first</span>
                  : <>Collect <span className="font-bold">{peso(collect)}</span></>}
          </span>
          {next && (
            <button disabled={next === 'delivered' && needsActual}
              onClick={async () => { await data.advance(order, next); await onChange(); }}
              className="rounded-xl bg-brand-green px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {STATUS_ACTION[next]}
            </button>
          )}
        </div>

        {/* Breakdown / can't-continue handoff: return to the pool. */}
        <button onClick={release} disabled={releasing}
          className="mt-3 w-full rounded-xl border border-red-300 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
          {releasing ? 'Transferring…' : '⚠️ Can’t continue — transfer delivery'}
        </button>
        {hasGoods && (
          <p className="mt-1.5 text-center text-[11px] text-black/45">
            You already have the items — coordinate the hand-over with the rider who takes it.
          </p>
        )}
        {releaseErr && <p className="mt-2 text-xs text-red-600">{releaseErr}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earnings / settlement
// ---------------------------------------------------------------------------

function EarningsView({ live, ledger, owed, overdue, onSettle }:
  { live: boolean; ledger: LedgerEntry[]; owed: number; overdue: number; onSettle: (extra?: { reference?: string; receiptUrl?: string }) => Promise<void> }) {
  const history = useMemo(() => [...ledger].sort((a, b) => b.businessDay.localeCompare(a.businessDay)), [ledger]);
  const [payOpen, setPayOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => { if (live && supabase) getAppSettings(supabase).then(setSettings).catch(() => {}); }, [live]);

  return (
    <div className="space-y-4">
      <SectionTitle>Earnings &amp; settlement</SectionTitle>
      <div className="rounded-2xl bg-gradient-to-br from-brand-green to-brand-purple p-5 text-white shadow-md">
        <p className="text-xs uppercase tracking-wide text-white/80">Commission owed to operator</p>
        <p className="mt-1 text-3xl font-black">{peso(owed)}</p>
        <p className="mt-1 text-xs text-white/85">
          Settle your commission before the end of the day — any unsettled balance locks
          your account at midnight until it's paid.
        </p>
        {owed > 0 && (
          <button onClick={() => setPayOpen(true)} className="mt-3 w-full rounded-xl bg-white py-2.5 text-sm font-bold text-brand-purple">
            Settle {peso(owed)} now
          </button>
        )}
        {overdue > 0 && (
          <p className="mt-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs font-medium text-white">
            ⚠️ {peso(overdue)} overdue — your account is locked until you settle.
          </p>
        )}
      </div>

      {payOpen && (
        <SettleModal amount={owed} settings={settings} live={live}
          onClose={() => setPayOpen(false)}
          onSubmit={async (extra) => { await onSettle(extra); setPayOpen(false); }} />
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <p className="mb-2 text-sm font-semibold">Commission history</p>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-black/40">No commission recorded yet.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {history.map((e) => (
              <li key={e.businessDay} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-black/60">{e.businessDay}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{peso(e.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.settled ? 'bg-brand-green/15 text-green-800' : 'bg-brand-yellow/30 text-yellow-800'}`}>
                    {e.settled ? 'Settled' : 'Unsettled'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Payment sheet: shows the operator's GCash/QR and takes a receipt + reference. */
function SettleModal({ amount, settings, live, onClose, onSubmit }: {
  amount: number; settings: AppSettings | null; live: boolean;
  onClose: () => void; onSubmit: (extra?: { reference?: string; receiptUrl?: string }) => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const num = settings?.settlement_gcash_number ?? null;

  async function upload(file: File) {
    if (!supabase) return;
    setUploading(true); setErr(null);
    try { setReceiptUrl(await uploadSettlementReceipt(supabase, file)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }
  async function submit() {
    setSubmitting(true); setErr(null);
    try { await onSubmit({ reference: reference.trim() || undefined, receiptUrl: receiptUrl ?? undefined }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setSubmitting(false); }
  }
  function copyNum() {
    if (!num) return;
    void navigator.clipboard?.writeText(num).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <h3 className="text-lg font-extrabold">Settle {peso(amount)}</h3>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-black/60">✕</button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-black/60">Send your commission to the operator, then submit your proof of payment.</p>

          {/* Operator GCash / QR */}
          <div className="rounded-2xl bg-brand-purple/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-purple">Pay via GCash / Maya</p>
            {num ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black text-brand-ink">{num}</p>
                    {settings?.settlement_gcash_name && <p className="text-sm text-black/55">{settings.settlement_gcash_name}</p>}
                  </div>
                  <button onClick={copyNum} className="shrink-0 rounded-lg bg-brand-purple px-3 py-1.5 text-xs font-bold text-white">
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {settings?.settlement_qr_url && (
                  <img src={settings.settlement_qr_url} alt="GCash QR"
                    className="mx-auto mt-3 h-56 w-56 rounded-xl bg-white object-contain p-2 ring-1 ring-black/5" />
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-black/50">
                {live ? 'The operator hasn’t set their payment details yet — please contact them for where to send payment.'
                      : 'Payment details appear here once the operator sets them.'}
              </p>
            )}
          </div>

          {/* Proof of payment */}
          <div>
            <label className="mb-1 block text-sm font-medium">Reference number <span className="font-normal text-black/40">(optional)</span></label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="GCash reference #"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Receipt / screenshot <span className="font-normal text-red-500">*required</span></label>
            {receiptUrl ? (
              <div className="flex items-center gap-3">
                <img src={receiptUrl} alt="Receipt" className="h-20 w-20 rounded-lg object-cover ring-1 ring-black/10" />
                <button onClick={() => setReceiptUrl(null)} className="text-sm font-medium text-red-600">Remove</button>
              </div>
            ) : (
              <label className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-black/20 py-3 text-sm font-medium text-black/60 ${!live ? 'pointer-events-none opacity-50' : ''}`}>
                {uploading ? 'Uploading…' : '＋ Upload receipt'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
              </label>
            )}
          </div>

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          <button onClick={submit} disabled={submitting || uploading || (live && !receiptUrl)}
            className="w-full rounded-xl bg-brand-green py-3 font-bold text-white disabled:opacity-50">
            {submitting ? 'Submitting…' : `I’ve paid ${peso(amount)} — submit`}
          </button>
          <p className="text-center text-xs text-black/40">
            {live && !receiptUrl
              ? 'Upload your payment receipt to submit.'
              : 'The operator confirms your payment; your balance clears once confirmed.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <p className="mb-3 text-sm font-bold">{title}</p>
      {children}
    </div>
  );
}

const settingsInp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

function SettingsView({ live, online, busy, onToggleOnline, profile, onProfileSaved }: {
  live: boolean; online: boolean; busy: boolean; onToggleOnline: () => void;
  profile: RiderProfile | null; onProfileSaved: () => Promise<void>;
}) {
  const canEdit = live && !!supabase;
  return (
    <div className="space-y-4">
      <SectionTitle>Settings</SectionTitle>
      <OnlineToggle online={online} busy={busy} onToggle={onToggleOnline} />

      {canEdit && profile && <ProfileSection profile={profile} onSaved={onProfileSaved} />}
      {canEdit && profile && <PayoutSection profile={profile} onSaved={onProfileSaved} />}
      {canEdit && profile && <ServicesSection profile={profile} onSaved={onProfileSaved} />}
      {canEdit && profile && <PushSection profile={profile} onSaved={onProfileSaved} />}

      <LocationSection />

      <SettingsCard title="Help & support">
        <p className="mb-3 text-sm text-black/55">Reach the operator if you have an issue with an order or your account.</p>
        <div className="flex gap-2">
          <a href={`tel:${SUPPORT_CONTACT.replace(/\s/g, '')}`}
            className="flex-1 rounded-xl bg-brand-green py-2.5 text-center text-sm font-bold text-white">Call operator</a>
          <a href={`sms:${SUPPORT_CONTACT.replace(/\s/g, '')}`}
            className="flex-1 rounded-xl bg-brand-purple py-2.5 text-center text-sm font-bold text-white">Message</a>
        </div>
      </SettingsCard>

      <SettingsCard title="About">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-black/55">App version</span><span className="font-medium">{APP_VERSION}</span></div>
          <div className="flex justify-between">
            <span className="text-black/55">Connection</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${live ? 'bg-brand-green/15 text-green-800' : 'bg-brand-yellow/30 text-yellow-800'}`}>{live ? 'Live' : 'Preview mode'}</span>
          </div>
          <a href={TERMS_URL} target="_blank" rel="noreferrer" className="block pt-1 text-brand-purple">Terms &amp; Privacy →</a>
        </div>
      </SettingsCard>

      {live && supabase && (
        <button onClick={() => void signOut(supabase!)}
          className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-red-600 shadow-sm ring-1 ring-black/5">
          Log out
        </button>
      )}
      {!canEdit && <p className="px-1 text-xs text-black/40">Connect the app to edit your profile.</p>}
      <p className="px-1 pb-2 text-center text-xs text-black/35">Easy Buy Delivery — Rider · v{APP_VERSION}</p>
    </div>
  );
}

/** Reusable save wrapper: runs an update, reloads the profile, shows state. */
function useSaver(onSaved: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setSaved(false); setErr(null);
    try { await fn(); await onSaved(); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return { busy, saved, err, run, setSaved };
}

function ProfileSection({ profile, onSaved }: { profile: RiderProfile; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [mobile, setMobile] = useState(profile.mobile_number);
  const [vehicle, setVehicle] = useState(profile.vehicle ?? '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const { busy, saved, err, run, setSaved } = useSaver(onSaved);
  const dirty = name !== profile.name || mobile !== profile.mobile_number || vehicle !== (profile.vehicle ?? '');

  async function save() {
    await run(() => updateRiderProfile(supabase!, {
      name, mobile, vehicle,
      payoutNumber: profile.payout_number, services: profile.services_accepted,
      pushEnabled: profile.push_enabled, photoUrl: profile.photo_url,
    }));
  }
  async function pickPhoto(file: File) {
    setPhotoBusy(true);
    try {
      const url = await uploadRiderPhoto(supabase!, file);
      await updateRiderProfile(supabase!, {
        name: profile.name, mobile: profile.mobile_number, vehicle: profile.vehicle,
        photoUrl: url, payoutNumber: profile.payout_number,
        services: profile.services_accepted, pushEnabled: profile.push_enabled,
      });
      await onSaved();
    } catch { /* surfaced elsewhere */ } finally { setPhotoBusy(false); }
  }

  return (
    <SettingsCard title="Profile">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-green/15 text-2xl">
          {profile.photo_url ? <img src={profile.photo_url} alt="" className="h-full w-full object-cover" /> : '🛵'}
        </span>
        <label className="cursor-pointer rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/[0.03]">
          {photoBusy ? 'Uploading…' : 'Change photo'}
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); }} />
        </label>
      </div>
      <div className="space-y-2">
        <input className={settingsInp} placeholder="Full name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        <input className={settingsInp} placeholder="Mobile number" inputMode="tel" value={mobile} onChange={(e) => { setMobile(e.target.value); setSaved(false); }} />
        <input className={settingsInp} placeholder="Vehicle (e.g. motorcycle)" value={vehicle} onChange={(e) => { setVehicle(e.target.value); setSaved(false); }} />
      </div>
      <button onClick={save} disabled={busy || !dirty || !name.trim() || !mobile.trim()}
        className="mt-3 w-full rounded-lg bg-brand-green py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </SettingsCard>
  );
}

function PayoutSection({ profile, onSaved }: { profile: RiderProfile; onSaved: () => Promise<void> }) {
  const [num, setNum] = useState(profile.payout_number ?? '');
  const { busy, saved, err, run, setSaved } = useSaver(onSaved);
  const dirty = num !== (profile.payout_number ?? '');
  async function save() {
    await run(() => updateRiderProfile(supabase!, {
      name: profile.name, mobile: profile.mobile_number, vehicle: profile.vehicle,
      photoUrl: profile.photo_url, payoutNumber: num,
      services: profile.services_accepted, pushEnabled: profile.push_enabled,
    }));
  }
  return (
    <SettingsCard title="Payout · GCash / Maya">
      <p className="mb-2 text-sm text-black/55">Shown to customers at the door so they can pay you online instead of cash.</p>
      <input className={settingsInp} placeholder="GCash / Maya number" inputMode="tel"
        value={num} onChange={(e) => { setNum(e.target.value); setSaved(false); }} />
      <button onClick={save} disabled={busy || !dirty}
        className="mt-3 w-full rounded-lg bg-brand-green py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy ? 'Saving…' : saved ? '✓ Saved' : 'Save payout number'}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </SettingsCard>
  );
}

function ServicesSection({ profile, onSaved }: { profile: RiderProfile; onSaved: () => Promise<void> }) {
  const { busy, run } = useSaver(onSaved);
  // null/empty accepted = all on.
  const accepted = new Set(profile.services_accepted ?? SERVICES.map((s) => s.key));
  function toggle(key: string) {
    const next = new Set(accepted);
    if (next.has(key)) next.delete(key); else next.add(key);
    const arr = SERVICES.map((s) => s.key).filter((k) => next.has(k));
    void run(() => updateRiderProfile(supabase!, {
      name: profile.name, mobile: profile.mobile_number, vehicle: profile.vehicle,
      photoUrl: profile.photo_url, payoutNumber: profile.payout_number,
      services: arr.length === SERVICES.length ? null : arr, // all → null
      pushEnabled: profile.push_enabled,
    }));
  }
  return (
    <SettingsCard title="Services I accept">
      <p className="mb-3 text-sm text-black/55">Only orders for the services you turn on will show in your pool.</p>
      <div className="divide-y divide-black/5">
        {SERVICES.map((s) => (
          <label key={s.key} className="flex items-center justify-between py-2.5">
            <span className="text-sm font-medium">{s.label}</span>
            <Switch on={accepted.has(s.key)} disabled={busy} onChange={() => toggle(s.key)} />
          </label>
        ))}
      </div>
    </SettingsCard>
  );
}

function PushSection({ profile, onSaved }: { profile: RiderProfile; onSaved: () => Promise<void> }) {
  const { busy, run } = useSaver(onSaved);
  function toggle() {
    void run(() => updateRiderProfile(supabase!, {
      name: profile.name, mobile: profile.mobile_number, vehicle: profile.vehicle,
      photoUrl: profile.photo_url, payoutNumber: profile.payout_number,
      services: profile.services_accepted, pushEnabled: !profile.push_enabled,
    }));
  }
  return (
    <SettingsCard title="Notifications">
      <label className="flex items-center justify-between">
        <span>
          <span className="block text-sm font-medium">New-order push alerts</span>
          <span className="block text-xs text-black/45">Get notified when orders enter the pool.</span>
        </span>
        <Switch on={profile.push_enabled} disabled={busy} onChange={toggle} />
      </label>
    </SettingsCard>
  );
}

function LocationSection() {
  const [state, setState] = useState<string>('checking');
  useEffect(() => {
    if (!('permissions' in navigator) || !navigator.permissions?.query) { setState('unknown'); return; }
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then((p) => { setState(p.state); p.onchange = () => setState(p.state); })
      .catch(() => setState('unknown'));
  }, []);
  function enable() {
    navigator.geolocation?.getCurrentPosition(() => setState('granted'), () => setState('denied'));
  }
  const label = state === 'granted' ? 'Allowed' : state === 'denied' ? 'Blocked' : state === 'prompt' ? 'Not set' : '—';
  const tint = state === 'granted' ? 'bg-brand-green/15 text-green-800'
    : state === 'denied' ? 'bg-red-100 text-red-700' : 'bg-brand-yellow/30 text-yellow-800';
  return (
    <SettingsCard title="Location">
      <div className="flex items-center justify-between">
        <span>
          <span className="block text-sm font-medium">GPS permission</span>
          <span className="block text-xs text-black/45">Needed to share your location during delivery.</span>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tint}`}>{label}</span>
      </div>
      {state !== 'granted' && (
        <button onClick={enable} className="mt-3 w-full rounded-lg bg-brand-purple py-2.5 text-sm font-bold text-white">
          Enable location
        </button>
      )}
    </SettingsCard>
  );
}

function Switch({ on, onChange, disabled = false }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${on ? 'bg-brand-green' : 'bg-black/20'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function OnlineToggle({ online, busy, onToggle }: { online: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} disabled={busy} aria-pressed={online}
      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left shadow-sm ring-1 transition disabled:opacity-70 ${
        online ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-brand-ink ring-black/10'
      }`}>
      <span className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-white' : 'bg-black/30'}`} />
        <span className="font-bold">{busy ? 'Saving…' : online ? "You're online" : "You're offline"}</span>
      </span>
      <span className={`relative h-6 w-11 rounded-full transition ${online ? 'bg-white/30' : 'bg-black/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${online ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function LockCard({ overdue, onSettle, compact = false }: { overdue: number; onSettle: () => void; compact?: boolean }) {
  return (
    <div className={`rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5 ${compact ? '' : 'mt-2'}`}>
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">🔒</div>
      <h2 className="text-lg font-bold">Account locked</h2>
      <p className="mt-1 text-sm text-black/60">Settle yesterday's commission balance to accept new orders.</p>
      <p className="my-4 text-3xl font-black text-brand-purple">{peso(overdue)}</p>
      <button onClick={onSettle} className="w-full rounded-xl bg-brand-green py-3 font-semibold text-white">
        {compact ? 'Go to settlement' : `Settle ${peso(overdue)} to continue`}
      </button>
    </div>
  );
}

function OfflineCard({ onGoOnline, busy }: { onGoOnline: () => void; busy: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.05] text-2xl">😴</div>
      <h2 className="text-lg font-bold">You're offline</h2>
      <p className="mt-1 text-sm text-black/60">Go online to see the order pool and accept deliveries.</p>
      <button onClick={onGoOnline} disabled={busy}
        className="mt-4 w-full rounded-xl bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Saving…' : 'Go online'}
      </button>
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) =>
  <h2 className="mb-2 text-lg font-extrabold">{children}</h2>;

const Empty = ({ children, icon = '📭' }: { children: React.ReactNode; icon?: string }) => (
  <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
    <div className="mb-2 text-3xl">{icon}</div>
    <p className="text-sm text-black/50">{children}</p>
  </div>
);

function BottomNav({ tab, onTab, requests, deliveries }:
  { tab: Tab; onTab: (t: Tab) => void; requests: number; deliveries: number }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1.5">
        <NavBtn active={tab === 'dashboard'} onClick={() => onTab('dashboard')} label="Dashboard" icon={<HomeIcon />} />
        <NavBtn active={tab === 'requests'} onClick={() => onTab('requests')} label="Requests" icon={<InboxIcon />} badge={requests} />
        <NavBtn active={tab === 'deliveries'} onClick={() => onTab('deliveries')} label="Deliveries" icon={<BoxIcon />} badge={deliveries} />
        <NavBtn active={tab === 'earnings'} onClick={() => onTab('earnings')} label="Earnings" icon={<WalletIcon />} />
        <NavBtn active={tab === 'settings'} onClick={() => onTab('settings')} label="Settings" icon={<GearIcon />} />
      </div>
    </nav>
  );
}

function NavBtn({ active, onClick, label, icon, badge = 0 }:
  { active: boolean; onClick: () => void; label: string; icon: React.ReactNode; badge?: number }) {
  return (
    <button onClick={onClick}
      className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition ${
        active ? 'text-brand-green' : 'text-black/45 hover:text-black/70'
      }`}>
      <span className={`relative flex h-7 w-7 items-center justify-center rounded-full transition ${active ? 'bg-brand-green/15' : ''}`}>
        {icon}
        {badge > 0 && (
          <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-purple px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ic = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function HomeIcon() { return <svg {...ic}><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>; }
function InboxIcon() { return <svg {...ic}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z" /></svg>; }
function BoxIcon() { return <svg {...ic}><path d="M21 8V6a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 6v12a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 18z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>; }
function WalletIcon() { return <svg {...ic}><path d="M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M2 9V7a2 2 0 0 1 2-2h13M17 13h.01" /></svg>; }
function GearIcon() { return <svg {...ic}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>; }
function BellIcon() { return <svg {...ic} width="20" height="20"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>; }
function PhoneIcon() { return <svg {...ic} width="14" height="14"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>; }
function ChatIcon() { return <svg {...ic} width="14" height="14"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></svg>; }
