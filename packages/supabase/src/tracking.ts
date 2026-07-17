/**
 * Live location transport over Supabase Realtime.
 *
 * The rider app publishes lat/lng on a per-order channel while a delivery is
 * active; the customer app subscribes to move the marker on the map. Broadcast
 * (not table writes) keeps it cheap; optionally persist to `rider_locations`
 * for replay.
 */

import { TRACKING_INTERVAL_MS, type LatLng } from '@ebd/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LocationPing extends LatLng {
  at: number; // epoch ms
}

const channelName = (orderId: string) => `track:order:${orderId}`;
const EVENT = 'loc';

/** Subscribe to a rider's live location for an order. Returns an unsubscribe fn. */
export function subscribeRiderLocation(
  db: SupabaseClient,
  orderId: string,
  onPing: (ping: LocationPing) => void,
): () => void {
  const channel = db
    .channel(channelName(orderId))
    .on('broadcast', { event: EVENT }, (msg) => onPing(msg.payload as LocationPing))
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

/**
 * Start publishing the rider's location for an order every ~4s using the
 * provided position source (e.g. navigator.geolocation). Returns a stop fn.
 * Auto-start on pickup, stop on delivery.
 */
export function startPublishingLocation(
  db: SupabaseClient,
  orderId: string,
  getPosition: () => Promise<LatLng>,
  intervalMs: number = TRACKING_INTERVAL_MS,
): () => void {
  const channel = db.channel(channelName(orderId));
  channel.subscribe();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const pos = await getPosition();
      await channel.send({
        type: 'broadcast',
        event: EVENT,
        payload: { ...pos, at: Date.now() } satisfies LocationPing,
      });
    } catch {
      // transient position/broadcast error — skip this tick
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    void db.removeChannel(channel);
  };
}

/** Optional: persist a ping to rider_locations for replay/audit. */
export async function persistRiderLocation(
  db: SupabaseClient,
  riderId: string,
  orderId: string,
  pos: LatLng,
) {
  const { error } = await db
    .from('rider_locations')
    .insert({ rider_id: riderId, order_id: orderId, lat: pos.lat, lng: pos.lng });
  if (error) throw error;
}
