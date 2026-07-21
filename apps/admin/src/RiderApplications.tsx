import { useEffect, useState } from 'react';
import { listRiders, setRiderApplicationStatus } from '@ebd/supabase';
import type { RiderApplicationStatus } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { Th, Td, Muted, ErrorNote, StatusPill, Card } from './ui.tsx';

interface RiderRow {
  id: string;
  name: string;
  mobile_number: string;
  vehicle: string | null;
  application_status: RiderApplicationStatus;
}

const SAMPLE: RiderRow[] = [
  { id: 'r1', name: 'Cy Ramos', mobile_number: '0917 555 1000', vehicle: 'Motorcycle', application_status: 'pending' },
  { id: 'r2', name: 'Ben Cruz', mobile_number: '0918 555 2000', vehicle: 'Motorcycle', application_status: 'approved' },
  { id: 'r3', name: 'Dina Lim', mobile_number: '0919 555 3000', vehicle: 'Bicycle', application_status: 'pending' },
];

export function RiderApplications() {
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) { setRows(SAMPLE); setLoading(false); return; }
    setLoading(true);
    try { setRows((await listRiders(supabase)) as RiderRow[]); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function decide(id: string, status: RiderApplicationStatus) {
    if (!supabase) { setRows((rs) => rs.map((r) => r.id === id ? { ...r, application_status: status } : r)); return; }
    await setRiderApplicationStatus(supabase, id, status);
    await load();
  }

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;
  if (rows.length === 0) return <Muted>No rider applications yet.</Muted>;

  return (
    <Card title="Rider applications">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-black/50">
            <tr className="border-b border-black/5"><Th>Name</Th><Th>Mobile</Th><Th>Vehicle</Th><Th>Status</Th><Th> </Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-black/[0.04]">
                <Td className="font-medium">{r.name}</Td>
                <Td>{r.mobile_number}</Td>
                <Td>{r.vehicle ?? '—'}</Td>
                <Td><StatusPill status={r.application_status} /></Td>
                <Td>
                  {r.application_status === 'pending' && (
                    <span className="flex gap-2">
                      <button onClick={() => decide(r.id, 'approved')}
                        className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white">Approve</button>
                      <button onClick={() => decide(r.id, 'rejected')}
                        className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600">Reject</button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
