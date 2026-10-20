import { useEffect, useRef, useState } from 'react';
import { routeDistanceKm, type RoutePoint } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

/** Six decimal places is about 10 cm — finer than any pin a thumb can drop. */
const key = (p: RoutePoint | null | undefined) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : '';

export interface RouteKm {
  /** Measured road km for the farthest leg, or null while unknown. */
  km: number | null;
  /** True while a measurement is in flight, so the quote can say so. */
  measuring: boolean;
  /** True once we have asked and been told no road could be measured. */
  failed: boolean;
}

/**
 * The road distance behind the quote the customer is looking at.
 *
 * The fee is a distance times a rate, and the straight line is not the distance
 * ridden — a drop-off 1.9 km across the river is 4.6 km by road, because the
 * bridge is a long way south. So the road gets measured here, while the
 * customer is still deciding, rather than after they have agreed to a price.
 *
 * Deliberately not blocking. Routing is somebody else's server: until it
 * answers (or if it never does) the quote stands on the straight-line estimate,
 * which carries its own detour correction. Moving a pin cancels the measurement
 * in flight, since its answer is about a place the customer has left.
 */
export function useRouteKm(
  origins: readonly (RoutePoint | null | undefined)[],
  dropoff: RoutePoint | null | undefined,
  enabled = true,
): RouteKm {
  const [state, setState] = useState<RouteKm>({ km: null, measuring: false, failed: false });

  // The pins as a string, so a re-rendered array of the same coordinates does
  // not spend a routing request.
  const pins = origins.map(key).filter(Boolean).sort().join('|');
  const to = key(dropoff);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || !supabase || !to || !pins) {
      setState({ km: null, measuring: false, failed: false });
      return;
    }
    const mine = ++latest.current;
    setState((s) => ({ ...s, measuring: true, failed: false }));

    // A customer dragging the map would otherwise fire a request per frame.
    const timer = setTimeout(() => {
      void (async () => {
        const parse = (s: string): RoutePoint => {
          const [lat, lng] = s.split(',');
          return { lat: Number(lat), lng: Number(lng) };
        };
        const res = await routeDistanceKm(
          supabase!, pins.split('|').map(parse), parse(to),
        );
        if (latest.current !== mine) return; // a pin moved; this answer is stale
        setState({ km: res.km, measuring: false, failed: res.km === null });
      })();
    }, 500);

    return () => clearTimeout(timer);
  }, [pins, to, enabled]);

  return state;
}
