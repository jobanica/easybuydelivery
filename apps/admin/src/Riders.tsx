import { useEffect, useState } from 'react';
import { listActiveRiders, setRiderLocked, type ActiveRider } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import { Card, Th, Td, Muted, ErrorNote, peso } from './ui.tsx';

const today = new Date().toISOString().slice(0, 10);

const SAMPLE: ActiveRider[] = [
  { id: 'a', name: 'Ben Cruz', mobile_number: '0918 555 2000', vehicle: 'Motorcycle', is_locked: false, owed: 9, overdue: 0, activity: 'on_delivery', activeOrder: { id: 'o1', service_type: 'food', status: 'on_the_way' } },
  { id: 'b', name: 'Cy Ramos', mobile_number: '0917 555 1000', vehicle: 'Motorcycle', is_locked: false, owed: 19.5, overdue: 13.5, activity: 'locked', activeOrder: null },
  { id: 'c', name: 'Dina Lim', mobile_number: '0919 555 3000', vehicle: 'Bicycle', is_locked: false, owed: 0, overdue: 0, activity: 'available', activeOrder: null },
];

const activityChip: Record<string, string> = {
  on_delivery: 'bg-brand-purple/15 text-brand-purple',
  available: 'bg-brand-green/15 text-green-800',
  locked: 'bg-red-100 text-red-700',
};
const activityLabel: Record<string, string> = { on_delivery: 'On delivery', available: 'Available', locked: 'Locked' };

export function Riders() {
  const [rows, setRows] = useState<ActiveRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) { setRows(SAMPLE); setLoading(false); return; }
    setLoading(true);
    try { setRows(await listActiveRiders(supabase, today)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function toggleLock(r: ActiveRider) {
    if (!supabase) {
      setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, is_locked: !x.is_locked, activity: !x.is_locked ? 'locked' : (x.activeOrder ? 'on_delivery' : 'available') } : x));
      return;
    }
    await setRiderLocked(supabase, r.id, !r.is_locked);
    await load();
  }

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;
  if (rows.length === 0) return <Muted>No approved riders yet.</Muted>;

  const onDelivery = rows.filter((r) => r.activity === 'on_delivery').length;
  const available = rows.filter((r) => r.activity === 'available').length;
  const locked = rows.filter((r) => r.activity === 'locked').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Mini label="On delivery" value={onDelivery} tint="bg-brand-purple/15 text-brand-purple" />
        <Mini label="Available" value={available} tint="bg-brand-green/15 text-green-800" />
        <Mini label="Locked" value={locked} tint="bg-red-100 text-red-700" />
      </div>

      <Card title="Approved riders">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-black/50">
              <tr className="border-b border-black/5">
                <Th>Rider</Th><Th>Status</Th><Th>Current delivery</Th><Th>Owed</Th><Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-black/[0.04]">
                  <Td>
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-black/40">{r.mobile_number} · {r.vehicle ?? '—'}</span>
                  </Td>
                  <Td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${activityChip[r.activity]}`}>{activityLabel[r.activity]}</span></Td>
                  <Td>
                    {r.activeOrder
                      ? <span className="capitalize">{r.activeOrder.service_type} · {r.activeOrder.status.replaceAll('_', ' ')}</span>
                      : <span className="text-black/30">—</span>}
                  </Td>
                  <Td>
                    <span className={r.overdue > 0 ? 'font-medium text-red-600' : ''}>{peso(r.owed)}</span>
                    {r.overdue > 0 && <span className="block text-xs text-red-500">{peso(r.overdue)} overdue</span>}
                  </Td>
                  <Td>
                    <button onClick={() => toggleLock(r)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        r.is_locked ? 'bg-brand-green text-white' : 'border border-red-300 text-red-600'
                      }`}>
                      {r.is_locked ? 'Unlock' : 'Lock'}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Mini({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-black/5">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tint}`}>{label}</span>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
    </div>
  );
}
