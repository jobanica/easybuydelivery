import { useEffect, useState } from 'react';
import { addOrderItem, listOrderStores, listMenu, type AddableStore } from '@ebd/supabase';
import { errMessage } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { peso } from './ui.tsx';

interface MenuItem { id: string; name: string; price: number; description: string | null }

/**
 * "I forgot the drinks."
 *
 * Adding one more thing from a store already on the order, while the rider is
 * still at or heading to it. No second delivery fee, no phone call, and the
 * bill matches what was actually bought — which is the part that was going
 * wrong when people rang their rider instead.
 *
 * Closes once the food is collected: at that point the counter is behind them.
 */
export function AddToOrder({ orderId, status, onAdded }: {
  orderId: string;
  status: string;
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<AddableStore[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Only while the rider is still at or heading to the shop.
  const canAdd = ['pending', 'accepted', 'preparing'].includes(status);

  useEffect(() => {
    if (!open || !supabase) return;
    listOrderStores(supabase, orderId)
      .then((s) => { setStores(s); setStoreId((cur) => cur ?? s[0]?.storeId ?? null); })
      .catch((e) => setErr(errMessage(e)));
  }, [open, orderId]);

  useEffect(() => {
    if (!open || !storeId || !supabase) return;
    setItems(null);
    listMenu(supabase, storeId)
      .then((m) => setItems((m.items ?? []) as MenuItem[]))
      .catch((e) => setErr(errMessage(e)));
  }, [open, storeId]);

  async function add(item: MenuItem) {
    if (!supabase) return;
    setBusy(item.id); setErr(null);
    try {
      await addOrderItem(supabase, orderId, item.id, 1);
      setAdded((a) => [...a, item.id]);
      await onAdded();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!canAdd) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg border border-brand-green/50 px-2.5 py-1 text-xs font-semibold text-green-700">
        ➕ Add more items
      </button>
    );
  }

  const shown = (items ?? []).filter((i) =>
    !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="mt-2 w-full rounded-xl bg-brand-green/[0.05] p-3 ring-1 ring-brand-green/25">
      <p className="text-sm font-bold text-green-900">Add from the same store</p>
      <p className="mt-0.5 text-xs text-green-900/70">
        Your rider is told straight away. If the kitchen has run out they'll mark it and you won't be charged.
      </p>

      {stores.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {stores.map((s) => (
            <button key={s.storeId} onClick={() => setStoreId(s.storeId)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                storeId === s.storeId ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'}`}>
              {s.storeName}
            </button>
          ))}
        </div>
      )}

      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the menu"
        className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm" />

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {items === null ? (
          <p className="py-3 text-center text-xs text-black/40">Loading the menu…</p>
        ) : shown.length === 0 ? (
          <p className="py-3 text-center text-xs text-black/40">Nothing matches that.</p>
        ) : shown.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{i.name}</span>
              <span className="text-xs text-black/45">{peso(i.price)}</span>
            </span>
            <button onClick={() => void add(i)} disabled={busy === i.id}
              className="shrink-0 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              {busy === i.id ? 'Adding…' : added.includes(i.id) ? '✓ Added — add again' : 'Add'}
            </button>
          </div>
        ))}
      </div>

      <button onClick={() => setOpen(false)}
        className="mt-2 w-full rounded-lg border border-black/10 bg-white py-2 text-xs font-semibold text-black/60">
        Done
      </button>
    </div>
  );
}
