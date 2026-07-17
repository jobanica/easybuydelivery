import { useEffect, useState } from 'react';
import {
  listRiders,
  setRiderApplicationStatus,
  listOpenOrders,
} from '@ebd/supabase';
import type { RiderApplicationStatus } from '@ebd/shared';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { Stores } from './Stores.tsx';
import { Settlements } from './Settlements.tsx';

type Tab = 'riders' | 'orders' | 'stores' | 'settlements';

export function App() {
  const [tab, setTab] = useState<Tab>('riders');
  return (
    <div className="min-h-screen">
      <header className="bg-brand-purple text-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <h1 className="text-xl font-bold">Easy Buy Delivery — Admin</h1>
          <p className="text-sm opacity-90">Riders &amp; live orders</p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">
        {!isSupabaseConfigured && (
          <p className="mb-4 rounded-lg border border-brand-yellow bg-brand-yellow/20 px-3 py-2 text-sm">
            Preview mode — set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to load live data.
          </p>
        )}
        <nav className="mb-5 flex gap-2">
          <TabButton active={tab === 'stores'} onClick={() => setTab('stores')}>
            Stores &amp; menus
          </TabButton>
          <TabButton active={tab === 'riders'} onClick={() => setTab('riders')}>
            Rider applications
          </TabButton>
          <TabButton active={tab === 'orders'} onClick={() => setTab('orders')}>
            Live orders
          </TabButton>
          <TabButton active={tab === 'settlements'} onClick={() => setTab('settlements')}>
            Settlements
          </TabButton>
        </nav>
        {tab === 'stores' && <Stores />}
        {tab === 'riders' && <RiderApplications />}
        {tab === 'orders' && <LiveOrders />}
        {tab === 'settlements' && <Settlements />}
      </main>
    </div>
  );
}

interface RiderRow {
  id: string;
  name: string;
  mobile_number: string;
  vehicle: string | null;
  application_status: RiderApplicationStatus;
}

function RiderApplications() {
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows((await listRiders(supabase)) as RiderRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function decide(id: string, status: RiderApplicationStatus) {
    if (!supabase) return;
    await setRiderApplicationStatus(supabase, id, status);
    await load();
  }

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;
  if (rows.length === 0) return <Muted>No rider applications yet.</Muted>;

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.03] text-left text-black/60">
          <tr>
            <Th>Name</Th><Th>Mobile</Th><Th>Vehicle</Th><Th>Status</Th><Th> </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-black/5">
              <Td className="font-medium">{r.name}</Td>
              <Td>{r.mobile_number}</Td>
              <Td>{r.vehicle ?? '—'}</Td>
              <Td><StatusPill status={r.application_status} /></Td>
              <Td>
                {r.application_status === 'pending' && (
                  <span className="flex gap-2">
                    <button onClick={() => decide(r.id, 'approved')}
                      className="rounded bg-brand-green px-2 py-1 text-xs font-medium text-white">
                      Approve
                    </button>
                    <button onClick={() => decide(r.id, 'rejected')}
                      className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600">
                      Reject
                    </button>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface OrderRow {
  id: string;
  service_type: string;
  status: string;
  delivery_fee: number;
  commission_amount: number;
  customer_contact: string;
}

function LiveOrders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      try {
        setRows((await listOpenOrders(supabase)) as OrderRow[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;
  if (rows.length === 0) return <Muted>No open orders right now.</Muted>;

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.03] text-left text-black/60">
          <tr><Th>Service</Th><Th>Status</Th><Th>Contact</Th><Th>Fee</Th><Th>Commission</Th></tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-t border-black/5">
              <Td className="capitalize font-medium">{o.service_type}</Td>
              <Td className="capitalize">{o.status.replace('_', ' ')}</Td>
              <Td>{o.customer_contact}</Td>
              <Td>₱{Number(o.delivery_fee).toFixed(2)}</Td>
              <Td>₱{Number(o.commission_amount).toFixed(2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabButton({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-brand-green text-white' : 'bg-white text-black/60 ring-1 ring-black/10'
      }`}>
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: RiderApplicationStatus }) {
  const cls = {
    pending: 'bg-brand-yellow/30 text-yellow-800',
    approved: 'bg-brand-green/15 text-green-800',
    rejected: 'bg-red-100 text-red-700',
  }[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{status}</span>;
}

const Th = ({ children }: { children: React.ReactNode }) =>
  <th className="px-4 py-2 font-medium">{children}</th>;
const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) =>
  <td className={`px-4 py-3 ${className}`}>{children}</td>;
const Muted = ({ children }: { children: React.ReactNode }) =>
  <p className="rounded-xl bg-white p-6 text-sm text-black/50 shadow-sm ring-1 ring-black/5">{children}</p>;
const ErrorNote = ({ msg }: { msg: string }) =>
  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">{msg}</p>;
