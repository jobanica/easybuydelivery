/**
 * Incoming-order notifications.
 *
 * Two layers:
 *  - Realtime `postgres_changes` on the order queue — riders see new orders live
 *    while the app is open (this module).
 *  - Push (FCM/APNs) for when the app is closed — device tokens are stored here;
 *    the actual send is a server-side Edge Function (see supabase/functions).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NewOrderEvent {
  id: string;
  service_type: 'food' | 'pabili' | 'padala';
  delivery_fee: number;
  commission_amount: number;
}

/**
 * Subscribe to new pending orders entering the pool. Fires `onOrder` for each
 * INSERT with status 'pending'. Returns an unsubscribe function.
 */
export function subscribeToNewOrders(
  db: SupabaseClient,
  onOrder: (order: NewOrderEvent) => void,
): () => void {
  const channel = db
    .channel('pool:new-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders', filter: 'status=eq.pending' },
      (payload) => onOrder(payload.new as NewOrderEvent),
    )
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

/**
 * Watch a rider's own orders change under them.
 *
 * The pool subscription above only fires on INSERT of a pending order, which
 * means a rider's list refreshed when somebody *else's* order arrived and at no
 * other time. An order cancelled out from under them therefore vanished at an
 * arbitrary later moment with no explanation — or sat on screen for as long as
 * the app stayed open, being worked on after it had been called off.
 *
 * This watches UPDATEs on the rows that are actually theirs, so the app finds
 * out when something happens to a job they are carrying.
 */
export function subscribeToMyOrders(
  db: SupabaseClient,
  riderId: string,
  onChange: (order: { id: string; status: string }) => void,
): () => void {
  const channel = db
    .channel(`rider:${riderId}:orders`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `rider_id=eq.${riderId}` },
      (payload) => onChange(payload.new as { id: string; status: string }),
    )
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

/** Upsert a rider's device push token (FCM/APNs). */
export async function saveRiderPushToken(
  db: SupabaseClient,
  riderId: string,
  token: string,
  platform: 'android' | 'ios' = 'android',
) {
  const { error } = await db
    .from('rider_push_tokens')
    .upsert({ rider_id: riderId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'rider_id,token' });
  if (error) throw error;
}

/**
 * Store a browser push subscription for this rider.
 *
 * Not one opaque token but an endpoint and two keys: web push encrypts each
 * payload to the device that will read it, so the server cannot send without
 * them. The endpoint doubles as the identity, which is why it goes in `token`.
 */
export async function saveRiderWebPush(
  db: SupabaseClient,
  riderId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
) {
  const { error } = await db
    .from('rider_push_tokens')
    .upsert({
      rider_id: riderId,
      token: sub.endpoint,
      platform: 'web',
      p256dh: sub.p256dh,
      auth: sub.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'rider_id,token' });
  if (error) throw error;
}

/** Forget this device's subscription — the rider turned notifications off. */
export async function removeRiderWebPush(
  db: SupabaseClient, riderId: string, endpoint: string,
) {
  const { error } = await db
    .from('rider_push_tokens')
    .delete()
    .eq('rider_id', riderId)
    .eq('token', endpoint);
  if (error) throw error;
}

/**
 * Ask the server to push about this order.
 *
 * Invoked from whoever caused the event — the operator's console on a
 * cancellation — rather than from a database trigger, so there is no service
 * key sitting in the database and no webhook to configure by hand. The function
 * checks the caller is entitled to tell anyone about this order before it
 * sends, so being client-invoked costs nothing in safety.
 */
export async function pushAboutOrder(
  db: SupabaseClient, orderId: string, kind: 'cancelled' | 'new_order',
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await db.functions.invoke('push-riders', {
    body: { orderId, kind },
  });
  if (error) throw error;
  return data as { sent: number; failed: number };
}
