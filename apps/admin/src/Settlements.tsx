import { useEffect, useState } from 'react';
import { summarizeRiderBalances, type RiderBalance } from '@ebd/shared';
import { listRiderBalances, listPendingSettlements, confirmSettlement } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

const today = new Date().toISOString().slice(0, 10);
const peso = (n: number) => `₱${n.toFixed(2)}`;

interface PendingRow {
  id: string;
  rider_id: string;
  business_day: string;
  amount_due: number;
  method: string | null;
  reference: string | null;
}

/** Preview sample so the operator view is demoable without a backend. */
function sampleBalances(): RiderBalance[] {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  return summarizeRiderBalances(
    [
      { riderId: 'r-cy', riderName: 'Cy Ramos', entries: [
        { amount: 13.5, businessDay: yesterday, settled: false },
        { amount: 6, businessDay: today, settled: false },
      ] },
      { riderId: 'r-ben', riderName: 'Ben Cruz', entries: [
        { amount: 9, businessDay: today, settled: false },
      ] },
    ],
    today,
  );
}

export function Settlements() {
  const [balances, setBalances] = useState<RiderBalance[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      setBalances(sampleBalances());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [b, p] = await Promise.all([listRiderBalances(supabase, today), listPendingSettlements(supabase)]);
      setBalances(b);
      setPending(p as PendingRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function confirm(row: PendingRow) {
    if (!supabase) return;
    await confirmSettlement(supabase, {
      settlementId: row.id, riderId: row.rider_id, businessDay: row.business_day,
      adminProfileId: 'admin', today,
    });
    await load();
  }

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;

  const lockedCount = balances.filter((b) => b.locked).length;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">
          Who owes {lockedCount > 0 && <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{lockedCount} locked</span>}
        </h3>
        {balances.length === 0 ? (
          <Muted>All riders are settled up.</Muted>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] text-left text-black/60">
                <tr><Th>Rider</Th><Th>Owed</Th><Th>Overdue</Th><Th>Status</Th></tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.riderId} className="border-t border-black/5">
                    <Td className="font-medium">{b.riderName ?? b.riderId}</Td>
                    <Td>{peso(b.owed)}</Td>
                    <Td className={b.overdue > 0 ? 'text-red-600' : ''}>{peso(b.overdue)}</Td>
                    <Td>
                      {b.locked
                        ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Locked</span>
                        : <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-xs font-medium text-green-800">Active</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Pending settlements</h3>
        {!supabase ? (
          <Muted>Connect Supabase to receive and confirm rider payments.</Muted>
        ) : pending.length === 0 ? (
          <Muted>No settlements awaiting confirmation.</Muted>
        ) : (
          <div className="space-y-2">
            {pending.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="text-sm">
                  <span className="font-medium">{peso(row.amount_due)}</span>
                  <span className="text-black/50"> · {row.business_day} · {row.method ?? '—'}{row.reference ? ` (${row.reference})` : ''}</span>
                </div>
                <button onClick={() => confirm(row)}
                  className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white">
                  Mark paid
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="px-4 py-2 font-medium">{children}</th>;
const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) =>
  <td className={`px-4 py-3 ${className}`}>{children}</td>;
const Muted = ({ children }: { children: React.ReactNode }) =>
  <p className="rounded-xl bg-white p-6 text-sm text-black/50 shadow-sm ring-1 ring-black/5">{children}</p>;
const ErrorNote = ({ msg }: { msg: string }) =>
  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">{msg}</p>;
