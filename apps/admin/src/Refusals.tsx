import { useEffect, useMemo, useState } from 'react';
import {
  listRiderRequestEvents, summarizeRefusals,
  type RiderRequestEvent, type RiderRefusalTally,
} from '@ebd/supabase';
import { errMessage, manilaDay, shiftDay } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { Card, Th, Td, ErrorNote, peso } from './ui.tsx';

const today = manilaDay();
const RANGES = [7, 30, 90];

/** "Today 3:40 PM" / "Aug 1, 3:40 PM" (Manila). */
function when(iso: string): string {
  const d = new Date(iso);
  const day = manilaDay(d);
  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  if (day === today) return `Today ${time}`;
  if (day === shiftDay(today, -1)) return `Yesterday ${time}`;
  return `${new Date(`${day}T00:00:00`).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })}, ${time}`;
}

function sampleEvents(): RiderRequestEvent[] {
  const at = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
  return [
    { id: '1', riderId: 'b', riderName: 'Cy Ramos', orderId: 'o1', kind: 'transferred', reason: 'Flat tire', hadGoods: true, createdAt: at(40), order: { serviceType: 'food', status: 'delivered', deliveryFee: 55 } },
    { id: '2', riderId: 'b', riderName: 'Cy Ramos', orderId: 'o2', kind: 'declined', reason: null, hadGoods: false, createdAt: at(95), order: { serviceType: 'pabili', status: 'delivered', deliveryFee: 60 } },
    { id: '3', riderId: 'b', riderName: 'Cy Ramos', orderId: 'o3', kind: 'declined', reason: null, hadGoods: false, createdAt: at(180), order: { serviceType: 'padala', status: 'pending', deliveryFee: 40 } },
    { id: '4', riderId: 'a', riderName: 'Ben Cruz', orderId: 'o4', kind: 'declined', reason: null, hadGoods: false, createdAt: at(320), order: { serviceType: 'food', status: 'delivered', deliveryFee: 50 } },
    { id: '5', riderId: 'c', riderName: 'Dina Lim', orderId: 'o5', kind: 'transferred', reason: 'Rain, no raincoat', hadGoods: false, createdAt: at(1500), order: { serviceType: 'food', status: 'cancelled', deliveryFee: 50 } },
  ];
}

/** Load the history once and share it between the summary and the table. */
function useRefusals(days: number) {
  const [events, setEvents] = useState<RiderRequestEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEvents(null); setError(null);
    if (!supabase) { setEvents(sampleEvents()); return; }
    listRiderRequestEvents(supabase, { fromDay: shiftDay(today, -(days - 1)), toDay: today })
      .then((e) => { if (alive) setEvents(e); })
      .catch((e) => { if (alive) { setError(errMessage(e)); setEvents([]); } });
    return () => { alive = false; };
  }, [days]);

  const tally = useMemo(() => summarizeRefusals(events ?? []), [events]);
  return { events, tally, error };
}

const kindChip = (kind: string) => kind === 'transferred'
  ? 'bg-brand-yellow/30 text-yellow-800'
  : 'bg-black/[0.06] text-black/60';

/**
 * Dashboard card: who is turning work down lately.
 *
 * Declines and transfers are counted apart because they cost different things —
 * a pass leaves the request in the pool for the next rider, a transfer strands
 * an order someone is already waiting on, sometimes with the goods bought.
 */
export function RefusalSummary({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { tally, error } = useRefusals(7);

  return (
    <Card title="Declines &amp; transfers · last 7 days"
      action={<button onClick={() => onNavigate('riders')} className="text-sm font-medium text-brand-purple">Full history →</button>}>
      {error && <ErrorNote msg={error} />}
      {tally.length === 0 ? (
        <p className="py-2 text-sm text-black/50">No requests turned down in the last 7 days.</p>
      ) : (
        <ul className="divide-y divide-black/5">
          {tally.slice(0, 6).map((r) => (
            <li key={r.riderId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-brand-ink">{r.riderName}</span>
                <span className="block text-xs text-black/40">most recent · {when(r.lastAt)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {r.transferred > 0 && (
                  <span className="rounded-full bg-brand-yellow/30 px-2.5 py-0.5 font-medium text-yellow-800">
                    {r.transferred} transferred{r.transferredWithGoods > 0 ? ` · ${r.transferredWithGoods} with goods` : ''}
                  </span>
                )}
                {r.declined > 0 && (
                  <span className="rounded-full bg-black/[0.06] px-2.5 py-0.5 font-medium text-black/60">
                    {r.declined} declined
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Riders page: the full log, with the per-rider tally above it. */
export function RefusalHistory() {
  const [days, setDays] = useState(30);
  const { events, tally, error } = useRefusals(days);

  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
      on ? 'bg-brand-green text-white ring-brand-green' : 'bg-white text-black/60 ring-black/10'}`;

  return (
    <Card
      title="Declines &amp; transfers"
      action={
        <span className="flex gap-2">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={chip(days === r)}>{r} days</button>
          ))}
        </span>
      }
    >
      {error && <ErrorNote msg={error} />}
      {!events ? (
        <p className="text-sm text-black/40">Loading…</p>
      ) : events.length === 0 ? (
        <p className="py-2 text-sm text-black/50">Nothing turned down in this period.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {tally.map((r) => (
              <span key={r.riderId} className="rounded-xl bg-black/[0.03] px-3 py-2 text-xs">
                <span className="font-semibold text-brand-ink">{r.riderName}</span>
                <span className="text-black/50">
                  {' · '}{r.declined} declined · {r.transferred} transferred
                  {r.transferredWithGoods > 0 && ` (${r.transferredWithGoods} with goods)`}
                </span>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-black/50">
                <tr className="border-b border-black/5">
                  <Th>When</Th><Th>Rider</Th><Th>What</Th><Th>Order</Th><Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-black/[0.04]">
                    <Td className="whitespace-nowrap text-black/60">{when(e.createdAt)}</Td>
                    <Td><span className="font-medium">{e.riderName}</span></Td>
                    <Td>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${kindChip(e.kind)}`}>
                        {e.kind === 'transferred' ? 'Transferred' : 'Declined'}
                      </span>
                      {e.hadGoods && <span className="mt-0.5 block text-[11px] text-yellow-700">goods already bought</span>}
                    </Td>
                    <Td>
                      {e.order
                        ? <span className="capitalize text-black/60">
                            {e.order.serviceType} · {e.order.status.replaceAll('_', ' ')} · {peso(e.order.deliveryFee)}
                          </span>
                        : <span className="text-black/30">—</span>}
                    </Td>
                    <Td className="text-black/60">{e.reason ?? <span className="text-black/25">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
