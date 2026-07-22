import { useEffect, useState } from 'react';
import {
  listAllStores,
  createStore,
  setStoreAvailability,
  setStoreLocation,
  listMenu,
  createMenuItem,
  setMenuItemAvailability,
} from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import { ImportMenu } from './ImportMenu.tsx';
import { MapPicker, type MapValue } from './MapPicker.tsx';

interface StoreRow {
  id: string;
  name: string;
  category: string | null;
  contact_number: string | null;
  is_available: boolean;
  address: string | null;
  lat: number | null;
  lng: number | null;
}
interface ItemRow { id: string; name: string; price: number; is_available: boolean }

export function Stores() {
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);

  // New-store form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState<MapValue | null>(null);

  async function load() {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows((await listAllStores(supabase)) as StoreRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function addStore(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !name.trim()) return;
    try {
      await createStore(supabase, {
        name: name.trim(),
        category: category.trim() || undefined,
        contactNumber: contact.trim() || undefined,
        address: address.trim() || undefined,
        lat: pin?.lat,
        lng: pin?.lng,
      });
      setName(''); setCategory(''); setContact(''); setAddress(''); setPin(null); setError(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/row-level security|42501/.test(msg)
        ? 'Not authorized — sign in with an admin account to add stores.'
        : msg);
    }
  }

  async function toggle(id: string, available: boolean) {
    if (!supabase) return;
    await setStoreAvailability(supabase, id, available);
    await load();
  }

  if (loading) return <Muted>Loading…</Muted>;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => setImporting((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-black/10 hover:bg-black/[0.03]">
          {importing ? '← Add manually' : '⇪ Bulk import CSV'}
        </button>
      </div>

      {importing ? (
        <ImportMenu onDone={load} />
      ) : (
      <>
      <form onSubmit={addStore} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <h3 className="mb-3 font-semibold">Add a store</h3>
        <div className="grid grid-cols-3 gap-3">
          <input className={inp} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className={inp} placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className={inp} placeholder="Contact #" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <input className={inp + ' mt-3 w-full'} placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className="mt-3">
          <p className="mb-1.5 text-sm font-medium text-black/70">Store location</p>
          <MapPicker value={pin} onChange={setPin} />
        </div>
        <button className="mt-3 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white" disabled={!supabase}>
          Add store
        </button>
        {!supabase && <span className="ml-3 text-xs text-black/40">Connect Supabase to add stores.</span>}
      </form>

      {error && <ErrorNote msg={error} />}
      {rows.length === 0 && !error && <Muted>No stores yet.</Muted>}

      <div className="space-y-3">
        {rows.map((s) => (
          <div key={s.id} className="rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <div className="flex items-center justify-between p-4">
              <button className="text-left" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-black/40">{s.category ?? '—'}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  s.lat != null && s.lng != null ? 'bg-brand-green/15 text-green-800' : 'bg-brand-yellow/30 text-yellow-800'
                }`}>
                  {s.lat != null && s.lng != null ? '📍 Pinned' : 'No location'}
                </span>
              </button>
              <label className="flex items-center gap-2 text-sm">
                <span className={s.is_available ? 'text-green-700' : 'text-black/40'}>
                  {s.is_available ? 'Open' : 'Off'}
                </span>
                <input type="checkbox" checked={s.is_available} onChange={(e) => toggle(s.id, e.target.checked)} />
              </label>
            </div>
            {openId === s.id && (
              <>
                <LocationEditor store={s} onSaved={load} />
                <MenuEditor storeId={s.id} />
              </>
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function LocationEditor({ store, onSaved }: { store: StoreRow; onSaved: () => void }) {
  const initial: MapValue | null =
    store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng } : null;
  const [pin, setPin] = useState<MapValue | null>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = pin?.lat !== initial?.lat || pin?.lng !== initial?.lng;

  async function save() {
    if (!supabase || !pin) return;
    setSaving(true); setSaved(false);
    try {
      await setStoreLocation(supabase, store.id, pin);
      setSaved(true);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="border-t border-black/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">Store location</h4>
        <button onClick={save} disabled={!supabase || !pin || !dirty || saving}
          className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : dirty ? 'Save location' : saved ? '✓ Saved' : 'Saved'}
        </button>
      </div>
      <MapPicker value={pin} onChange={(v) => { setPin(v); setSaved(false); }} height={220} />
      <p className="mt-1 text-xs text-black/40">
        The delivery fee is computed from this pin to the customer’s drop-off, so place it precisely.
      </p>
    </div>
  );
}

function MenuEditor({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  async function load() {
    if (!supabase) return;
    const menu = await listMenu(supabase, storeId, false);
    setItems(menu.items as ItemRow[]);
  }
  useEffect(() => { void load(); }, [storeId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !name.trim()) return;
    await createMenuItem(supabase, { storeId, name: name.trim(), price: Number(price) || 0 });
    setName(''); setPrice('');
    await load();
  }

  return (
    <div className="border-t border-black/5 bg-black/[0.015] p-4">
      <ul className="mb-3 divide-y divide-black/5">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between py-1.5 text-sm">
            <span>{it.name} · ₱{Number(it.price).toFixed(2)}</span>
            <label className="flex items-center gap-1 text-xs text-black/50">
              available
              <input type="checkbox" checked={it.is_available}
                onChange={async (e) => { if (supabase) { await setMenuItemAvailability(supabase, it.id, e.target.checked); await load(); } }} />
            </label>
          </li>
        ))}
        {items.length === 0 && <li className="py-1.5 text-xs text-black/40">No items yet.</li>}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input className={inp + ' flex-1'} placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp + ' w-24'} placeholder="Price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        <button className="rounded-lg bg-brand-purple px-3 py-2 text-sm font-medium text-white">Add item</button>
      </form>
    </div>
  );
}

const inp = 'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green';
const Muted = ({ children }: { children: React.ReactNode }) =>
  <p className="rounded-xl bg-white p-6 text-sm text-black/50 shadow-sm ring-1 ring-black/5">{children}</p>;
const ErrorNote = ({ msg }: { msg: string }) =>
  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">{msg}</p>;
