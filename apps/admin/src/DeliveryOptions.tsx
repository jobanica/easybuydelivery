import { useCallback, useEffect, useState } from 'react';
import { errMessage } from '@ebd/shared';
import {
  listDeliveryOptions, createDeliveryOption, updateDeliveryOption,
  deleteDeliveryOption, uploadDeliveryOptionImage, type DeliveryOption,
} from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

const inp = 'rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green';
const peso = (n: number) => `₱${Number(n).toFixed(2)}`;

/**
 * The vehicles the operator can put an order on, and what each costs.
 *
 * Deliberately not a fixed list. A tricycle in one town is a kuliglig in the
 * next, and a shop that starts with one trike may end up with a van — so the
 * names, the prices and the photos are all the operator's to set.
 *
 * Turning one off hides it from future orders without touching the ones it
 * already carried; deleting is blocked once it has been used, so an old order
 * can still say what brought it.
 */
export function DeliveryOptions() {
  const [rows, setRows] = useState<DeliveryOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');

  const load = useCallback(async () => {
    if (!supabase) { setRows([]); return; }
    try { setRows(await listDeliveryOptions(supabase, false)); setError(null); }
    catch (e) { setError(errMessage(e)); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !name.trim()) return;
    try {
      await createDeliveryOption(supabase, {
        name: name.trim(), fee: Number(fee) || 0, sortOrder: rows?.length ?? 0,
      });
      setName(''); setFee('');
      await load();
    } catch (e2) { setError(errMessage(e2)); }
  }

  async function patch(id: string, p: Parameters<typeof updateDeliveryOption>[2]) {
    if (!supabase) return;
    try { await updateDeliveryOption(supabase, id, p); await load(); }
    catch (e) { setError(errMessage(e)); }
  }

  async function remove(id: string) {
    if (!supabase) return;
    try { await deleteDeliveryOption(supabase, id); await load(); }
    catch (e) { setError(errMessage(e)); }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h3 className="font-semibold">Your own vehicles</h3>
      <p className="mb-3 mt-0.5 text-sm text-black/55">
        What you can put a shop order on when you deliver it yourself. Each carries its own
        fee — you pick one per order, and the customer is told in the chat.
      </p>

      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-3 space-y-1.5">
        {rows === null ? (
          <p className="text-sm text-black/40">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-black/50">
            No vehicles yet. Add a tricycle, a kuliglig, a closed van — whatever you actually run.
          </p>
        ) : rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ${
            r.is_active ? 'bg-white ring-black/5' : 'bg-black/[0.03] ring-black/5 opacity-60'}`}>
            <VehicleImage option={r} onDone={load} />
            <input defaultValue={r.name} onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== r.name) void patch(r.id, { name: v });
            }} className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium outline-none focus:bg-black/[0.04]" />
            <span className="flex shrink-0 items-center gap-1 text-sm">
              <span className="text-black/40">₱</span>
              <input type="number" min={0} step="0.01" defaultValue={r.fee}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0 && v !== Number(r.fee)) void patch(r.id, { fee: v });
                }}
                className="w-20 rounded border border-black/10 px-2 py-1 text-right text-sm" />
            </span>
            <button onClick={() => void patch(r.id, { isActive: !r.is_active })}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                r.is_active ? 'bg-brand-green/15 text-green-800' : 'bg-black/10 text-black/50'}`}>
              {r.is_active ? 'On' : 'Off'}
            </button>
            <button onClick={() => void remove(r.id)} title="Delete"
              className="shrink-0 text-black/30 hover:text-red-600">×</button>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input className={inp + ' min-w-0 flex-1'} placeholder="Vehicle (e.g. Tricycle, Closed van)"
          value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp + ' w-28'} type="number" min={0} step="0.01" placeholder="Fee"
          value={fee} onChange={(e) => setFee(e.target.value)} />
        <button className="rounded-lg bg-brand-green px-3 py-2 text-sm font-medium text-white">Add</button>
      </form>
      <p className="mt-2 text-xs text-black/40">
        Prices and names update as soon as you click away. {rows && rows.length > 0 && 'Turning one Off keeps past orders intact.'}
      </p>
    </div>
  );
}

/** A photo of the vehicle, so a customer knows what is turning up. */
function VehicleImage({ option, onDone }: { option: DeliveryOption; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-black/[0.04] ring-1 ring-black/10">
      {option.image_url
        ? <img src={option.image_url} alt="" className="h-full w-full object-cover" />
        : <span className="flex h-full w-full items-center justify-center text-base text-black/25">🚚</span>}
      {busy && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[10px]">…</span>}
      <input type="file" accept="image/*" className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !supabase) return;
          setBusy(true);
          try { await uploadDeliveryOptionImage(supabase, option.id, file); await onDone(); }
          finally { setBusy(false); }
        }} />
    </label>
  );
}
