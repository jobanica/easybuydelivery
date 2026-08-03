import { useEffect, useMemo, useState } from 'react';
import { listServiceAreas, groupAreas, type ServiceArea, type AreaSelection } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

const sel = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green';

const norm = (s: string) => s.trim().toLowerCase().replace(/^(city of|municipality of)\s+/, '').replace(/\s+city$/, '');

/**
 * Reverse-geocode a pin (OpenStreetMap Nominatim — same free service as the map
 * tiles) and check the municipality/city against the serviceable list.
 *
 * Returns `null` when the answer isn't trustworthy (offline, rate-limited, or
 * no city in the response) so a lookup failure never blocks a real order —
 * only a confident mismatch does.
 */
export async function checkPinServiceable(
  lat: number, lng: number, areas: ServiceArea[],
): Promise<{ ok: boolean; place: string } | null> {
  if (areas.length === 0) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=12`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const a = (await res.json())?.address ?? {};
    const city: string | undefined = a.city ?? a.town ?? a.municipality ?? a.village ?? a.county;
    if (!city) return null;
    const served = new Set(areas.map((x) => norm(x.city)));
    return { ok: served.has(norm(city)), place: city };
  } catch {
    return null; // never block on a lookup failure
  }
}

/**
 * Delivery-area picker: Province → City/Municipality → Barangay, listing only
 * the areas the operator serves. `onRequired` tells the form whether a choice
 * must be made — false only when no areas are configured at all, so the app
 * still works before setup.
 */
export function AreaPicker({ value, onChange, onRequired, onAreasLoaded }: {
  value: AreaSelection | null;
  onChange: (v: AreaSelection | null) => void;
  onRequired: (required: boolean) => void;
  onAreasLoaded?: (areas: ServiceArea[]) => void;
}) {
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [province, setProvince] = useState(value?.province ?? '');
  const [city, setCity] = useState(value?.city ?? '');

  useEffect(() => {
    if (!supabase) { setAreas([]); onRequired(false); return; }
    listServiceAreas(supabase)
      .then((a) => {
        const active = a.filter((x) => x.is_active);
        setAreas(active);
        // Report on load — not only when the user touches a dropdown — so the
        // form actually enforces the choice.
        onRequired(active.length > 0);
        onAreasLoaded?.(active);
      })
      .catch(() => { setAreas([]); onRequired(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => groupAreas(areas ?? []), [areas]);
  const provinces = [...grouped.keys()];
  const cities = province ? [...(grouped.get(province)?.keys() ?? [])] : [];
  const barangays = province && city ? (grouped.get(province)?.get(city) ?? []) : [];

  if (areas === null) return <p className="text-xs text-black/40">Loading delivery areas…</p>;
  if (areas.length === 0) return null; // no areas configured — nothing to choose

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-black/70">Delivery area</span>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={sel} value={province}
          onChange={(e) => { setProvince(e.target.value); setCity(''); onChange(null); }}>
          <option value="">Province…</option>
          {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={sel} value={city} disabled={!province}
          onChange={(e) => { setCity(e.target.value); onChange(null); }}>
          <option value="">City / Municipality…</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={sel} value={value?.barangay ?? ''} disabled={!city}
          onChange={(e) => {
            const b = e.target.value;
            onChange(b ? { province, city, barangay: b } : null);
          }}>
          <option value="">Barangay…</option>
          {barangays.map((b) => <option key={b.id} value={b.barangay}>{b.barangay}</option>)}
        </select>
      </div>
      <p className="mt-1 text-xs text-black/40">
        Only the areas we currently deliver to are listed. Don't see yours? We don't serve it yet.
      </p>
    </div>
  );
}
