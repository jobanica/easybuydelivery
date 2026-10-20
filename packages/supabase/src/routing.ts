/**
 * Road distance, for pricing a ride instead of a crow's flight.
 *
 * The delivery fee is a distance times a rate. For as long as the distance was
 * the straight line, every river and closed subdivision was crossed for free:
 * across forty recent deliveries the real ride was a median 1.29 times the
 * straight line and up to 3.3 times it, and those forty were underpaid by ₱635.
 *
 * Measuring a road needs the internet, so it happens in the `route-distance`
 * Edge Function rather than in Postgres. Two callers, two shapes:
 *
 *  - `routeDistanceKm` at checkout, before the order exists, so the price the
 *    customer agrees to is the price they are charged. A quote that arrives
 *    after the order would be a surcharge.
 *  - `applyRouteDistance` after a pin moves, which re-measures and lets the
 *    database rewrite the fee. The number a rider is paid is not a number the
 *    rider's app gets to send.
 *
 * Both are best-effort. Routing is a network call to somebody else's server;
 * if it is slow or down, the caller keeps the straight-line estimate (which
 * carries a detour correction of its own) rather than failing a checkout.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RoutePoint { lat: number; lng: number }

export interface RouteQuote {
  /** Road km for the farthest origin→drop-off leg. Null if nobody could measure it. */
  km: number | null;
  /** Which router answered — 'ors', 'osrm', or null when none did. */
  by: string | null;
}

const usable = (p: RoutePoint | null | undefined): p is RoutePoint =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/**
 * Measure the farthest store→drop-off leg by road.
 *
 * Returns `{ km: null }` rather than throwing: a checkout must not fail
 * because a routing service did. The caller falls back to the straight-line
 * estimate, which is approximate but no longer systematically low.
 */
export async function routeDistanceKm(
  db: SupabaseClient,
  origins: readonly (RoutePoint | null | undefined)[],
  dropoff: RoutePoint | null | undefined,
): Promise<RouteQuote> {
  const from = origins.filter(usable);
  if (!usable(dropoff) || from.length === 0) return { km: null, by: null };

  const { data, error } = await db.functions.invoke('route-distance', {
    body: { origins: from, dropoff },
  });
  if (error) {
    console.warn('route-distance unavailable, using the straight-line estimate', error);
    return { km: null, by: null };
  }
  const res = data as { routed?: boolean; km?: number; by?: string };
  return res?.routed && Number.isFinite(res.km)
    ? { km: Number(res.km), by: res.by ?? null }
    : { km: null, by: null };
}

/**
 * A pin moved and the database re-quoted from the straight line; now go and
 * measure the road, and fold the real fee back into what the caller shows.
 *
 * Two steps rather than one because the fee has to be correct the instant the
 * pin moves — a rider who sees "₱81" and then nothing is left wondering
 * whether the correction took. The straight-line re-quote lands immediately and
 * carries the detour factor; this replaces it with the measured figure a moment
 * later, usually before the rider has looked away.
 *
 * Returns the correction's own result untouched if nothing was re-priced, if
 * the road could not be measured, or if the order had already finished.
 */
export async function remeasureAfterPinMove<
  T extends { updated?: boolean; new_fee?: number },
>(db: SupabaseClient, orderId: string, result: T): Promise<T> {
  if (!result?.updated || result.new_fee === undefined) return result;
  const routed = await applyRouteDistance(db, orderId);
  return routed.updated && Number.isFinite(routed.new_fee)
    ? { ...result, new_fee: routed.new_fee as number, route_km: routed.km }
    : result;
}

export interface RouteApplied {
  updated: boolean;
  /** Present when nothing changed: 'finished', 'no_dropoff', 'no_origin', 'unrouted'. */
  reason?: string;
  km?: number;
  old_fee?: number;
  new_fee?: number;
  by?: string;
}

/**
 * Re-measure an existing order's road distance and let the server re-price it.
 *
 * For after a pin moves. The Edge Function checks the caller is entitled to the
 * order, measures, and hands the kilometres to `set_order_route_km`, which is
 * the only thing that may write a routed fee.
 *
 * Never throws. A pin correction that worked must not be reported as a failure
 * because the follow-up measurement could not be taken — the correction already
 * left the fee at a corrected straight-line estimate.
 */
export async function applyRouteDistance(
  db: SupabaseClient,
  orderId: string,
): Promise<RouteApplied> {
  try {
    const { data, error } = await db.functions.invoke('route-distance', {
      body: { orderId },
    });
    if (error) throw error;
    return data as RouteApplied;
  } catch (e) {
    console.warn('could not re-measure the road distance for', orderId, e);
    return { updated: false, reason: 'unavailable' };
  }
}
