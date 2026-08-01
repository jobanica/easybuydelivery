import { useEffect, useState, useCallback } from 'react';
import {
  getMyCustomer, listCustomerOrders, listAddresses, addAddress, deleteAddress, setDefaultAddress,
  getOrderPayToRider,
  type MyCustomer, type CustomerOrder, type CustomerAddress, type OrderPayToRider,
} from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { useAuth } from './auth/AuthContext.tsx';
import { LocationPicker, type LatLngValue } from './LocationPicker.tsx';
import { peso } from './ui.tsx';
import { REQUIRE_ACCOUNT, SUPPORT_CONTACT, APP_VERSION } from './config.ts';

const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

const serviceTint: Record<string, string> = {
  food: 'bg-brand-green/15 text-green-800',
  pabili: 'bg-brand-purple/15 text-brand-purple',
  padala: 'bg-brand-yellow/30 text-yellow-800',
};

function orderTotal(o: CustomerOrder): number {
  return o.goods_cost + o.delivery_fee + o.store_fee_total + o.convenience_fee;
}
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** Shows the assigned rider's GCash number so the sender can pay them. */
function PayRider({ orderId }: { orderId: string }) {
  const [info, setInfo] = useState<OrderPayToRider | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!supabase) return;
    setBusy(true);
    try { setInfo(await getOrderPayToRider(supabase, orderId)); setLoaded(true); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  }

  if (!loaded) {
    return (
      <button onClick={load} disabled={busy}
        className="mt-2 rounded-lg bg-brand-purple/10 px-3 py-1.5 text-xs font-semibold text-brand-purple disabled:opacity-60">
        {busy ? 'Checking…' : '💸 Pay your rider via GCash'}
      </button>
    );
  }
  if (!info || !info.rider_name) {
    return <p className="mt-2 text-xs text-black/45">Waiting for a rider to accept — check back to pay.</p>;
  }
  return (
    <div className="mt-2 rounded-lg bg-brand-purple/[0.06] px-3 py-2 text-xs">
      <p className="font-semibold text-brand-ink">Send {peso(info.amount)} to your rider</p>
      <p className="text-black/60">{info.rider_name}{info.payout_number ? ` · GCash/Maya: ${info.payout_number}` : ' · no GCash number on file yet'}</p>
      <p className="mt-1 text-black/45">The recipient pays nothing on delivery.</p>
    </div>
  );
}

export function Account() {
  const { ensureContact, signOut, live } = useAuth();
  const [customer, setCustomer] = useState<MyCustomer | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured) { setLoading(false); return; }
    try {
      const c = await getMyCustomer(supabase);
      setCustomer(c);
      if (c) {
        const [o, a] = await Promise.all([listCustomerOrders(supabase, c.id), listAddresses(supabase, c.id)]);
        setOrders(o); setAddresses(a);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!isSupabaseConfigured) {
    return <Card title="Account"><p className="text-sm text-black/50">Connect the app to manage your account.</p></Card>;
  }
  if (loading) return <p className="text-sm text-black/50">Loading…</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-extrabold">My account</h2>

      <ProfileSection customer={customer} ensureContact={ensureContact} onSaved={load} />

      {customer && <AddressesSection customerId={customer.id} addresses={addresses} onChange={load} />}

      {customer && (
        <Card title="Order history">
          {orders.length === 0 ? (
            <p className="text-sm text-black/40">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {orders.map((o) => (
                <li key={o.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${serviceTint[o.service_type] ?? 'bg-black/5'}`}>{o.service_type}</span>
                        <span className="text-xs capitalize text-black/50">{o.status.replaceAll('_', ' ')}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-black/45">
                        {fmtDate(o.created_at)}
                        {o.order_stores?.[0]?.store?.name ? ` · ${o.order_stores[0].store!.name}` : ''}
                        {o.recipient_name ? ` · 🎁 to ${o.recipient_name}` : ''}
                      </span>
                    </div>
                    <span className="shrink-0 text-sm font-bold">{peso(orderTotal(o))}</span>
                  </div>
                  {o.payment_method === 'rider_qr' && !['delivered', 'cancelled'].includes(o.status) && (
                    <PayRider orderId={o.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Help & support">
        <p className="mb-3 text-sm text-black/55">Questions about an order? Reach the operator.</p>
        <div className="flex gap-2">
          <a href={`tel:${SUPPORT_CONTACT.replace(/\s/g, '')}`} className="flex-1 rounded-xl bg-brand-green py-2.5 text-center text-sm font-bold text-white">Call</a>
          <a href={`sms:${SUPPORT_CONTACT.replace(/\s/g, '')}`} className="flex-1 rounded-xl bg-brand-purple py-2.5 text-center text-sm font-bold text-white">Message</a>
        </div>
      </Card>

      <Card title="About">
        <div className="flex justify-between text-sm"><span className="text-black/55">App version</span><span className="font-medium">{APP_VERSION}</span></div>
      </Card>

      {live && REQUIRE_ACCOUNT && (
        <button onClick={() => void signOut()} className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-red-600 shadow-sm ring-1 ring-black/5">
          Sign out
        </button>
      )}
      <p className="pb-2 text-center text-xs text-black/35">Easy Buy Delivery · v{APP_VERSION}</p>
    </div>
  );
}

function ProfileSection({ customer, ensureContact, onSaved }: {
  customer: MyCustomer | null; ensureContact: (mobile: string, name?: string) => Promise<string>; onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [mobile, setMobile] = useState(customer?.mobile_number && customer.mobile_number !== 'unknown' ? customer.mobile_number : '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!mobile.trim()) { setErr('Enter your mobile number.'); return; }
    setBusy(true); setSaved(false); setErr(null);
    try { await ensureContact(mobile.trim(), name.trim() || undefined); await onSaved(); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Profile">
      <div className="space-y-2">
        <input className={inp} placeholder="Your name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        <input className={inp} placeholder="Mobile number" inputMode="tel" value={mobile} onChange={(e) => { setMobile(e.target.value); setSaved(false); }} />
      </div>
      <button onClick={save} disabled={busy}
        className="mt-3 w-full rounded-lg bg-brand-green py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy ? 'Saving…' : saved ? '✓ Saved' : 'Save profile'}
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </Card>
  );
}

function AddressesSection({ customerId, addresses, onChange }: {
  customerId: string; addresses: CustomerAddress[]; onChange: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [pin, setPin] = useState<LatLngValue | null>(null);
  const [makeDefault, setMakeDefault] = useState(addresses.length === 0);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!supabase || !text.trim()) return;
    setBusy(true);
    try {
      await addAddress(supabase, { customerId, label, address: text, lat: pin?.lat ?? null, lng: pin?.lng ?? null, isDefault: makeDefault });
      setLabel(''); setText(''); setPin(null); setAdding(false);
      await onChange();
    } finally { setBusy(false); }
  }
  async function remove(id: string) { if (supabase) { await deleteAddress(supabase, id); await onChange(); } }
  async function makeDef(id: string) { if (supabase) { await setDefaultAddress(supabase, customerId, id); await onChange(); } }

  return (
    <Card title="Saved addresses">
      {addresses.length === 0 && !adding && <p className="mb-2 text-sm text-black/40">No saved addresses yet.</p>}
      <ul className="space-y-2">
        {addresses.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {a.label || 'Address'}
                {a.is_default && <span className="ml-2 rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-semibold text-green-800">Default</span>}
              </p>
              <p className="truncate text-xs text-black/50">{a.address}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {!a.is_default && <button onClick={() => makeDef(a.id)} className="text-[11px] font-medium text-brand-purple">Set default</button>}
              <button onClick={() => remove(a.id)} className="text-[11px] font-medium text-red-600">Delete</button>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-xl bg-black/[0.02] p-3">
          <input className={inp} placeholder="Label (e.g. Home, Office)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className={inp} placeholder="Address / landmark" value={text} onChange={(e) => setText(e.target.value)} />
          <LocationPicker value={pin} onChange={setPin} height={180} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-[#6DBE22]" />
            Set as default
          </label>
          <div className="flex gap-2">
            <button onClick={() => setAdding(false)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm font-semibold text-black/60">Cancel</button>
            <button onClick={add} disabled={busy || !text.trim()} className="flex-1 rounded-lg bg-brand-green py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save address'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-3 w-full rounded-lg border border-dashed border-brand-purple/50 py-2.5 text-sm font-semibold text-brand-purple hover:bg-brand-purple/5">
          ＋ Add an address
        </button>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <p className="mb-3 text-sm font-bold">{title}</p>
      {children}
    </div>
  );
}
