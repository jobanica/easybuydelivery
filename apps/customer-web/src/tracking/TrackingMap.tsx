import type { LatLng } from '@ebd/shared';
import { useTracking } from './useTracking.ts';

/**
 * Lightweight self-contained tracking map: projects pickup / dropoff / rider
 * into an SVG viewbox and shows the live ETA. Production would swap this SVG
 * for Leaflet + OSM tiles or Mapbox (open decision #9) using the same
 * useTracking feed.
 */
export function TrackingMap({
  pickup, dropoff, orderId, onClose,
}: { pickup: LatLng; dropoff: LatLng; orderId?: string; onClose?: () => void }) {
  const { rider, etaMin, progress, live } = useTracking(pickup, dropoff, orderId);

  // Project lat/lng into a padded 320x220 box (invert lat for screen y).
  const pts = [pickup, dropoff, rider];
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const pad = 0.15;
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = (maxLat - minLat) || 1, spanLng = (maxLng - minLng) || 1;
  const W = 320, H = 220;
  const x = (p: LatLng) => (((p.lng - minLng) / spanLng) * (1 - 2 * pad) + pad) * W;
  const y = (p: LatLng) => (1 - (((p.lat - minLat) / spanLat) * (1 - 2 * pad) + pad)) * H;

  const arrived = progress >= 1;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Tracking your rider</h2>
        {onClose && <button onClick={onClose} className="text-sm text-brand-purple">Close</button>}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-[#eef3ea]" role="img" aria-label="rider location map">
        {/* route */}
        <line x1={x(pickup)} y1={y(pickup)} x2={x(dropoff)} y2={y(dropoff)}
          stroke="#5e2d91" strokeWidth={2} strokeDasharray="5 4" />
        {/* pickup */}
        <circle cx={x(pickup)} cy={y(pickup)} r={6} fill="#5e2d91" />
        <text x={x(pickup) + 9} y={y(pickup) + 4} fontSize={10} fill="#333">Pickup</text>
        {/* dropoff */}
        <circle cx={x(dropoff)} cy={y(dropoff)} r={6} fill="#1e1e1e" />
        <text x={x(dropoff) + 9} y={y(dropoff) + 4} fontSize={10} fill="#333">Drop-off</text>
        {/* rider */}
        <g transform={`translate(${x(rider)}, ${y(rider)})`}>
          <circle r={9} fill="#6dbe22" stroke="#fff" strokeWidth={2} />
          <text x={0} y={4} fontSize={11} textAnchor="middle">🛵</text>
        </g>
      </svg>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-black/60">
          {live ? 'Live' : 'Simulated'} · {Math.round(progress * 100)}% of the way
        </span>
        <span className="rounded-lg bg-brand-green/15 px-3 py-1 text-sm font-semibold text-green-800">
          {arrived ? 'Arriving now' : `ETA ~${Math.max(1, Math.round(etaMin))} min`}
        </span>
      </div>
    </div>
  );
}
