import { useEffect, useState } from 'react';
import { getActiveDelivery, getOrderRiderInfo, type ActiveDelivery, type OrderRiderInfo } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { TrackingMap } from './TrackingMap.tsx';

// Demo route for preview mode (no backend).
const DEMO_PICKUP = { lat: 14.170, lng: 121.240 };
const DEMO_DROPOFF = { lat: 14.186, lng: 121.256 };

/**
 * Track tab: finds the customer's current in-progress delivery and shows the
 * live rider map for it. Falls back to a simulated demo in preview mode and a
 * friendly empty state when there's nothing to track.
 */
export function Track({ onClose }: { onClose: () => void }) {
  const { live, customerId } = useAuth();
  const [status, setStatus] = useState<'loading' | 'none' | 'ok' | 'nocoords'>('loading');
  const [delivery, setDelivery] = useState<ActiveDelivery | null>(null);
  const [riderInfo, setRiderInfo] = useState<OrderRiderInfo | null>(null);

  useEffect(() => {
    if (!live || !supabase || !customerId) return;
    let cancelled = false;
    async function load() {
      try {
        const d = await getActiveDelivery(supabase!, customerId!);
        if (cancelled) return;
        setDelivery(d);
        setStatus(!d ? 'none' : d.pickup && d.dropoff ? 'ok' : 'nocoords');
        setRiderInfo(d ? await getOrderRiderInfo(supabase!, d.id).catch(() => null) : null);
      } catch {
        if (!cancelled) setStatus('none');
      }
    }
    void load();
    const t = setInterval(load, 15_000); // re-check which order is active / its status
    return () => { cancelled = true; clearInterval(t); };
  }, [live, customerId]);

  // Preview mode: show the simulated demo so the map is demonstrable.
  if (!live) return <TrackingMap pickup={DEMO_PICKUP} dropoff={DEMO_DROPOFF} onClose={onClose} />;

  if (status === 'ok' && delivery?.pickup && delivery.dropoff) {
    return (
      <TrackingMap pickup={delivery.pickup} dropoff={delivery.dropoff} orderId={delivery.id}
        deliveryStatus={delivery.status} courier={riderInfo} onClose={onClose} />
    );
  }

  return (
    <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Track your delivery</h2>
        <button onClick={onClose} className="text-sm text-brand-purple">Close</button>
      </div>
      {status === 'loading' ? (
        <p className="py-6 text-sm text-black/50">Checking for an active delivery…</p>
      ) : status === 'nocoords' ? (
        <p className="py-6 text-sm text-black/60">
          Your rider is on the way ({delivery?.status.replaceAll('_', ' ')}). A live map isn't available for this order because no map location was set.
        </p>
      ) : (
        <>
          <div className="mx-auto mb-3 mt-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">🛵</div>
          <p className="text-sm text-black/60">No delivery in progress. Live tracking appears here once a rider is on the way with your order.</p>
        </>
      )}
    </div>
  );
}
