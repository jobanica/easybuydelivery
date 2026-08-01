import { useEffect, useMemo, useState } from 'react';
import { listServiceAreas, groupAreas, type ServiceArea, type AreaSelection } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

const sel = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green';

/**
 * Delivery-area picker: Province → City/Municipality → Barangay, listing only
 * the areas the operator serves. Reports the selection upward; when no areas
 * are configured at all the check is skipped (`onChange` gets a null selection
 * and `serviceable` stays true) so the app still works before setup.
 */
export function AreaPicker({ value, onChange }: {
  value: AreaSelection | null;
  onChange: (v: AreaSelection | null, serviceable: boolean) => void;
}) {
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [province, setProvince] = useState(value?.province ?? '');
  const [city, setCity] = useState(value?.city ?? '');

  useEffect(() => {
    if (!supabase) { setAreas([]); onChange(null, true); return; }
    listServiceAreas(supabase)
      .then((a) => {
        const active = a.filter((x) => x.is_active);
        setAreas(active);
        if (active.length === 0) onChange(null, true); // not configured — don't block
      })
      .catch(() => { setAreas([]); onChange(null, true); });
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
          onChange={(e) => { setProvince(e.target.value); setCity(''); onChange(null, true); }}>
          <option value="">Province…</option>
          {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={sel} value={city} disabled={!province}
          onChange={(e) => { setCity(e.target.value); onChange(null, true); }}>
          <option value="">City / Municipality…</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={sel} value={value?.barangay ?? ''} disabled={!city}
          onChange={(e) => {
            const b = e.target.value;
            onChange(b ? { province, city, barangay: b } : null, true);
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
