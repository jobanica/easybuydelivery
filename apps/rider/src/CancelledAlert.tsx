import { useCallback, useEffect, useRef, useState } from 'react';
import { playCancelAlert } from './alert.ts';

const SEEN_KEY = 'ebd:rider-seen-cancellations';

/**
 * One cancelled job, as the rider needs to read it.
 *
 * Spelled out rather than inferred from the query, because PostgREST hands
 * embeds back as arrays whether or not the relationship is one-to-one, and the
 * banner should not be shaped by that quirk.
 */
interface Cancelled {
  id: string;
  service_type: string;
  notes: string | null;
  goods_cost: number | null;
  customer_name: string | null;
  delivery_address: string | null;
  storeName: string | null;
}

/** Normalise one row from the data layer into what the banner shows. */
function toCancelled(row: Record<string, unknown>): Cancelled {
  const stores = row.order_stores as { store?: { name?: string } | { name?: string }[] }[] | undefined;
  const first = stores?.[0]?.store;
  const store = Array.isArray(first) ? first[0] : first;
  return {
    id: String(row.id),
    service_type: String(row.service_type ?? 'order'),
    notes: row.notes == null ? null : String(row.notes),
    goods_cost: row.goods_cost == null ? null : Number(row.goods_cost),
    customer_name: row.customer_name == null ? null : String(row.customer_name),
    delivery_address: row.delivery_address == null ? null : String(row.delivery_address),
    storeName: store?.name ?? null,
  };
}

function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

function markSeen(ids: string[]) {
  try {
    const all = [...seen(), ...ids];
    // Only the recent tail is worth remembering; the query only looks back a day.
    localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-50)));
  } catch { /* private mode: the banner reappears, which is the safe way to fail */ }
}

/** "Cancelled by admin: out of stock" → "out of stock". */
function reasonFrom(notes: string | null): string | null {
  if (!notes) return null;
  const line = notes.split('\n').reverse()
    .find((l) => l.toLowerCase().startsWith('cancelled by admin:'));
  const reason = line?.slice(line.indexOf(':') + 1).trim();
  return reason || null;
}

const peso = (n: number) => `₱${Number(n || 0).toFixed(2)}`;

/**
 * What happened to the job that disappeared.
 *
 * A cancelled order drops out of the active list, because it is not work any
 * more — but dropping silently is how a rider ends up at a counter paying for
 * goods nobody is coming to collect. This is the explanation: what it was, who
 * it was for, and the reason the operator gave, held until the rider has
 * actually acknowledged it rather than until the next render.
 *
 * Dismissal is kept on the device. Getting it wrong in the safe direction means
 * showing the notice twice; the unsafe direction is a rider never seeing it.
 */
export function CancelledAlert({ data, refreshKey }: {
  /** Already bound to this rider — the component needs no id of its own. */
  data: { listCancelled: () => Promise<Record<string, unknown>[]> };
  /** Bumped by the caller when an order of this rider's changes. */
  refreshKey: number;
}) {
  const [rows, setRows] = useState<Cancelled[]>([]);
  const announced = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const all = (await data.listCancelled()).map(toCancelled);
      const already = seen();
      const fresh = all.filter((o) => !already.has(o.id));
      setRows(fresh);

      // Make a noise once per cancellation, not once per poll.
      const unannounced = fresh.filter((o) => !announced.current.has(o.id));
      if (unannounced.length > 0) {
        for (const o of unannounced) announced.current.add(o.id);
        playCancelAlert();
      }
    } catch { /* a rider mid-shift does not need a loading error about this */ }
  }, [data]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {rows.map((o) => {
        const reason = reasonFrom(o.notes);
        const store = o.storeName;
        const goods = Number(o.goods_cost ?? 0);
        return (
          <div key={o.id} className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
            <div className="flex items-start gap-2">
              <span className="text-xl leading-none">⛔</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-red-800">
                  Your {o.service_type} order was cancelled
                </p>
                <p className="mt-0.5 text-sm text-red-900/80">
                  {store ? `${store} · ` : ''}
                  {o.customer_name ?? 'Customer'}
                  {o.delivery_address ? ` · ${o.delivery_address}` : ''}
                </p>
                {reason && (
                  <p className="mt-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-sm text-red-900">
                    <span className="font-semibold">Reason: </span>{reason}
                  </p>
                )}
                {/* The money question is the one that matters at a counter. */}
                {goods > 0 && (
                  <p className="mt-1.5 text-sm font-semibold text-red-900">
                    Stop before paying. Goods on this order: {peso(goods)}.
                    {' '}If you already paid, message the operator now.
                  </p>
                )}
                <button
                  onClick={() => { markSeen([o.id]); setRows((r) => r.filter((x) => x.id !== o.id)); }}
                  className="mt-2.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white">
                  Got it
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
