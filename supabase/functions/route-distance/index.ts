// Supabase Edge Function: how far is the ride, really.
//
// The delivery fee is a distance times a rate, and until now the distance was
// the straight line between the store and the door. Riders do not fly. Measured
// against routed road distance over forty recent deliveries the real ride was a
// median 1.29 times the straight line and as much as 3.3 times it — a river
// runs between Floridablanca and Guagua, so a drop-off 1.9 km away is 4.6 km by
// road, down to the bridge at Mabical and back up. Those forty orders were
// underpaid by ₱635 between them.
//
// Routing needs the internet, which Postgres has no business doing
// mid-transaction, so the measuring happens here. Two things ask for it:
//
//   { origins: [{lat,lng}], dropoff: {lat,lng} }  -> just the distance, for a
//        checkout quote. There is no order yet; the customer is being shown a
//        price before they agree to it, which is the whole point of doing this
//        before the order exists rather than correcting it afterwards.
//
//   { orderId }                                   -> measure and re-price, for
//        when a pin moves after the fact. Writing the fee is the database's
//        job (set_order_route_km); this only supplies the number of kilometres.
//
//   supabase secrets set ORS_API_KEY=...   # optional, see below
//   supabase functions deploy route-distance

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { preflight, withCors } from '../_shared/cors.ts';

interface Point { lat: number; lng: number }

const ok = (p: Point | null | undefined): p is Point =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Straight-line km. Kept here as the yardstick every routed answer is judged against. */
function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// The routers
// ---------------------------------------------------------------------------

/** Give up on a router rather than hold up a checkout. */
async function fetchJson(url: string, init: RequestInit = {}, ms = 4500) {
  const stop = AbortSignal.timeout(ms);
  const res = await fetch(url, { ...init, signal: stop });
  if (!res.ok) throw new Error(`${url.split('?')[0]} -> ${res.status}`);
  return await res.json();
}

/**
 * OpenRouteService. Wants an API key, free for 2,000 routes a day, which is
 * two orders of magnitude more than this operator uses. Preferred when the key
 * is set because it comes with terms of service.
 */
async function viaOrs(a: Point, b: Point, key: string): Promise<number> {
  const body = await fetchJson('https://api.openrouteservice.org/v2/directions/driving-car', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }),
  });
  const m = body?.routes?.[0]?.summary?.distance;
  if (!Number.isFinite(m)) throw new Error('ORS returned no distance');
  return Number(m) / 1000;
}

/**
 * OSRM's public demo server. No key, no sign-up, and the project asks that it
 * not be relied on in production — so it is the fallback, not the plan. Set
 * ORS_API_KEY and this stops being used.
 */
async function viaOsrm(a: Point, b: Point): Promise<number> {
  const path = `${a.lng},${a.lat};${b.lng},${b.lat}`;
  const body = await fetchJson(
    `https://router.project-osrm.org/route/v1/driving/${path}?overview=false&alternatives=false`,
  );
  const m = body?.routes?.[0]?.distance;
  if (!Number.isFinite(m)) throw new Error('OSRM returned no distance');
  return Number(m) / 1000;
}

/**
 * The road distance from a to b, or null if nobody could tell us.
 *
 * Sanity-checked against the straight line, because a router that snaps a pin
 * to the wrong road — the far bank, a ferry route, a highway it could not reach
 * — returns a confident number that is simply wrong, and this number sets what
 * a customer is charged. A road cannot be shorter than the straight line, and
 * one four times longer (plus a couple of km of slack, so a 200 m hop around a
 * one-way system is not clamped) is a mistake rather than a detour.
 */
async function roadKm(a: Point, b: Point): Promise<{ km: number; by: string } | null> {
  const direct = haversineKm(a, b);
  const key = Deno.env.get('ORS_API_KEY');
  const routers: [string, () => Promise<number>][] = [];
  if (key) routers.push(['ors', () => viaOrs(a, b, key)]);
  routers.push(['osrm', () => viaOsrm(a, b)]);

  for (const [by, run] of routers) {
    try {
      const km = await run();
      const ceiling = Math.max(direct * 4, direct + 2);
      if (km < direct * 0.9 || km > ceiling) {
        console.warn(`route-distance: ${by} said ${km.toFixed(2)} km for a ${direct.toFixed(2)} km line — ignoring`);
        continue;
      }
      return { km: Math.max(km, direct), by };
    } catch (e) {
      console.warn(`route-distance: ${by} failed`, (e as Error)?.message ?? e);
    }
  }
  return null;
}

/**
 * The farthest leg, by road.
 *
 * Mirrors quote_delivery_fee and resolveDeliveryFee: a rider calling at three
 * shops still covers at least the longest store-to-door leg, and the extra
 * stops are billed through the per-store fee rather than the distance.
 */
async function farthestLegKm(origins: Point[], dropoff: Point) {
  let best: { km: number; by: string } | null = null;
  for (const o of origins.slice(0, 3)) {
    const leg = await roadKm(o, dropoff);
    if (leg && (!best || leg.km > best.km)) best = leg;
  }
  return best;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('route-distance', e);
    return withCors(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

const json = (body: unknown, status = 200) =>
  withCors(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return withCors('POST only', { status: 405 });

  const auth = req.headers.get('Authorization');
  if (!auth) return withCors('not authenticated', { status: 401 });

  const { orderId, origins, dropoff } = await req.json().catch(() => ({}));

  // --- Quote mode: a price to show someone before they commit to it. --------
  if (!orderId) {
    const to = ok(dropoff) ? dropoff as Point : null;
    const from = Array.isArray(origins) ? (origins as Point[]).filter(ok) : [];
    if (!to || from.length === 0) {
      return withCors('origins and dropoff are required when there is no orderId', { status: 400 });
    }
    const leg = await farthestLegKm(from, to);
    // Nothing is written and nothing private is read, so there is no order to
    // be entitled to — this returns the length of a road, which is on the map.
    return json(leg
      ? { routed: true, km: Number(leg.km.toFixed(3)), by: leg.by }
      : { routed: false, reason: 'unrouted' });
  }

  // --- Apply mode: a pin moved, so the fee has to move with it. -------------
  //
  // Authorised by asking the question as the caller: the row comes back only
  // for the customer who placed the order, the rider carrying it, or staff. A
  // session with no business with this order gets nothing to re-price.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: order, error: readErr } = await asCaller
    .from('orders')
    .select('id, status, delivery_lat, delivery_lng')
    .eq('id', orderId)
    .maybeSingle();
  if (readErr) return withCors(readErr.message, { status: 400 });
  if (!order) return withCors('no such order, or not yours', { status: 404 });

  if (order.status === 'delivered' || order.status === 'cancelled') {
    return json({ updated: false, reason: 'finished' });
  }
  const to = ok({ lat: order.delivery_lat, lng: order.delivery_lng })
    ? { lat: order.delivery_lat as number, lng: order.delivery_lng as number }
    : null;
  if (!to) return json({ updated: false, reason: 'no_dropoff' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Where the fee is measured from, decided by the database — food starts at
  // the restaurants' own pins, pabili and padala at the pickup pin.
  const { data: pins, error: pinErr } = await admin.rpc('order_origin_pins', { p_order_id: orderId });
  if (pinErr) return withCors(pinErr.message, { status: 400 });
  const from = ((pins ?? []) as Point[]).filter(ok);
  if (from.length === 0) return json({ updated: false, reason: 'no_origin' });

  const leg = await farthestLegKm(from, to);
  if (!leg) {
    // The straight-line estimate already carries the detour correction, so an
    // unroutable order is merely approximate, not free.
    return json({ updated: false, reason: 'unrouted' });
  }

  const { data: applied, error: applyErr } = await admin
    .rpc('set_order_route_km', { p_order_id: orderId, p_km: Number(leg.km.toFixed(3)) });
  if (applyErr) return withCors(applyErr.message, { status: 400 });

  return json({ ...(applied as Record<string, unknown>), by: leg.by });
}
