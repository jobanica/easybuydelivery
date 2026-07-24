import { useEffect, useState } from 'react';
import { listOpenOrders } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import { Th, Td, Muted, ErrorNote, Card, peso } from './ui.tsx';

interface OrderRow {
  id: string;
  service_type: string;
  status: string;
  delivery_fee: number;
  commission_amount: number;
  customer_contact: string;
  notes?: string | null;
}

const SAMPLE: OrderRow[] = [
  { id: 'o1', service_type: 'food', status: 'pending', delivery_fee: 50, commission_amount: 7.5, customer_contact: '0917 111 2222' },
  { id: 'o2', service_type: 'pabili', status: 'accepted', delivery_fee: 60, commission_amount: 9, customer_contact: '0917 333 4444' },
  { id: 'o3', service_type: 'padala', status: 'on_the_way', delivery_fee: 40, commission_amount: 6, customer_contact: '0917 555 6666' },
];

const serviceColor: Record<string, string> = {
  food: 'bg-brand-green/15 text-green-800',
  pabili: 'bg-brand-purple/15 text-brand-purple',
  padala: 'bg-brand-yellow/30 text-yellow-800',
};

export function LiveOrders({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) { setRows(SAMPLE); setLoading(false); return; }
      try { setRows((await listOpenOrders(supabase)) as OrderRow[]); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <Muted>Loading…</Muted>;
  if (error) return <ErrorNote msg={error} />;

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-black/50">
          <tr className="border-b border-black/5"><Th>Service</Th><Th>Status</Th><Th>Contact</Th><Th>Fee</Th><Th>Commission</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><Td className="text-black/40">No open orders right now.</Td></tr>}
          {rows.map((o) => (
            <tr key={o.id} className="border-b border-black/[0.04]">
              <Td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${serviceColor[o.service_type] ?? 'bg-black/5'}`}>{o.service_type}</span></Td>
              <Td className="capitalize">{o.status.replaceAll('_', ' ')}</Td>
              <Td>
                {o.customer_contact}
                {o.notes && <span className="mt-0.5 block text-xs text-yellow-800">📝 {o.notes}</span>}
              </Td>
              <Td>{peso(o.delivery_fee)}</Td>
              <Td className="font-medium">{peso(o.commission_amount)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return embedded ? table : <Card title="Live orders">{table}</Card>;
}
