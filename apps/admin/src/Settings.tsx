import { useEffect, useState } from 'react';
import { getAppSettings, updateAppSettings, type AppSettings } from '@ebd/supabase';
import { commission, distanceDeliveryFee } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { Card, Muted, peso } from './ui.tsx';

const SAMPLE: AppSettings = {
  is_open: true, schedule: null, default_delivery_fee: 50, per_store_fee: 25,
  convenience_fee: 0, commission_rate: 0.15, delivery_fee_model: 'flat',
  settlement_cutoff: '00:00', sms_notify_stores: false,
  delivery_base_fare: 50, delivery_base_km: 2, delivery_per_km: 10,
  service_food: true, service_pabili: true, service_padala: true,
};

const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

export function Settings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewKm, setPreviewKm] = useState(5);

  useEffect(() => {
    (async () => {
      if (!supabase) { setS(SAMPLE); return; }
      try { setS(await getAppSettings(supabase)); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); setS(SAMPLE); }
    })();
  }, []);

  if (!s) return <Muted>Loading…</Muted>;

  function set<K extends keyof AppSettings>(k: K, v: AppSettings[K]) {
    setS((cur) => cur ? { ...cur, [k]: v } : cur);
    setSaved(false);
  }

  async function save() {
    if (!supabase || !s) return;
    setSaving(true); setError(null);
    try {
      await updateAppSettings(supabase, s);
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  // Live example: DF + 3 stores (2 added) at the current rate.
  const example = commission(
    { deliveryFee: s.default_delivery_fee, storeCount: 3 },
    { perStoreFee: s.per_store_fee, commissionRate: s.commission_rate, convenienceFee: s.convenience_fee },
  );

  return (
    <div className="max-w-3xl space-y-5">
      {/* Operating hours */}
      <Card title="Operating hours">
        <label className="flex items-center justify-between">
          <span>
            <span className="block text-sm font-medium">Platform is {s.is_open ? 'open' : 'closed'}</span>
            <span className="block text-xs text-black/50">When closed, customers can browse but not check out.</span>
          </span>
          <Toggle on={s.is_open} onChange={(v) => set('is_open', v)} />
        </label>
      </Card>

      {/* Services */}
      <Card title="Services">
        <p className="mb-3 text-sm text-black/60">
          Turn a whole service on or off. When off, customers see it greyed out and can’t order it.
        </p>
        <div className="divide-y divide-black/5">
          <ServiceRow label="Food / Restaurants" desc="Browse stores and order food."
            on={s.service_food} onChange={(v) => set('service_food', v)} />
          <ServiceRow label="Pabili" desc="Buy-anything errand service."
            on={s.service_pabili} onChange={(v) => set('service_pabili', v)} />
          <ServiceRow label="Padala" desc="Point-to-point courier."
            on={s.service_padala} onChange={(v) => set('service_padala', v)} />
        </div>
      </Card>

      {/* Fees & commission */}
      <Card title="Fees & commission">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delivery fee (₱)">
            <input type="number" min={0} className={inp} value={s.default_delivery_fee}
              onChange={(e) => set('default_delivery_fee', Number(e.target.value))} />
          </Field>
          <Field label="Delivery fee model">
            <select className={inp} value={s.delivery_fee_model}
              onChange={(e) => set('delivery_fee_model', e.target.value as AppSettings['delivery_fee_model'])}>
              <option value="flat">Flat</option>
              <option value="per_km">Per km</option>
              <option value="per_zone">Per zone</option>
            </select>
          </Field>
          <Field label="Per-store added fee (₱)">
            <input type="number" min={0} className={inp} value={s.per_store_fee}
              onChange={(e) => set('per_store_fee', Number(e.target.value))} />
          </Field>
          <Field label="Commission rate (%)">
            <input type="number" min={0} max={100} step={0.5} className={inp}
              value={Math.round(s.commission_rate * 1000) / 10}
              onChange={(e) => set('commission_rate', Number(e.target.value) / 100)} />
          </Field>
          <Field label="Convenience fee (₱) — goes to rider">
            <input type="number" min={0} className={inp} value={s.convenience_fee}
              onChange={(e) => set('convenience_fee', Number(e.target.value))} />
            <span className="mt-1 block text-xs text-black/40">Paid to the rider in full. No commission is taken on it.</span>
          </Field>
        </div>
        <p className="mt-4 rounded-lg bg-brand-green/10 px-3 py-2 text-sm text-green-800">
          Example: ₱{s.default_delivery_fee} delivery + {peso(s.per_store_fee)}×2 added stores →
          commission <span className="font-bold">{peso(example)}</span>
        </p>
      </Card>

      {/* Distance-based delivery fee */}
      <Card title="Distance-based delivery fee">
        <p className="mb-3 text-sm text-black/60">
          Used when <b>Delivery fee model</b> is set to <b>Per km</b>. The fee is measured from the
          store’s pinned location to the customer’s drop-off:
          <br />
          <span className="mt-1 inline-block rounded bg-black/[0.04] px-2 py-1 font-mono text-xs">
            fee = base fare + per-km × max(0, distance − base distance)
          </span>
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Base fare (₱)">
            <input type="number" min={0} className={inp} value={s.delivery_base_fare}
              onChange={(e) => set('delivery_base_fare', Number(e.target.value))} />
          </Field>
          <Field label="Base distance (km)">
            <input type="number" min={0} step={0.5} className={inp} value={s.delivery_base_km}
              onChange={(e) => set('delivery_base_km', Number(e.target.value))} />
          </Field>
          <Field label="Rate beyond base (₱/km)">
            <input type="number" min={0} step={0.5} className={inp} value={s.delivery_per_km}
              onChange={(e) => set('delivery_per_km', Number(e.target.value))} />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-brand-purple/[0.06] px-3 py-2">
          <span className="text-sm text-black/60">Preview a</span>
          <input type="number" min={0} step={0.5} value={previewKm}
            onChange={(e) => setPreviewKm(Number(e.target.value))}
            className="w-20 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm outline-none focus:border-brand-green" />
          <span className="text-sm text-black/60">km delivery →</span>
          <span className="text-sm font-bold text-brand-purple">
            {peso(distanceDeliveryFee(previewKm, {
              baseFare: s.delivery_base_fare, baseKm: s.delivery_base_km, perKm: s.delivery_per_km,
            }))}
          </span>
        </div>

        {s.delivery_fee_model !== 'per_km' && (
          <p className="mt-3 rounded-lg bg-brand-yellow/20 px-3 py-2 text-xs text-yellow-800">
            Heads up — the delivery fee model above is set to <b>{s.delivery_fee_model}</b>, so these
            rates aren’t applied yet. Switch it to <b>Per km</b> to charge by distance.
          </p>
        )}
      </Card>

      {/* Store SMS */}
      <Card title="Notifications">
        <label className="flex items-center justify-between">
          <span>
            <span className="block text-sm font-medium">Text stores their order items</span>
            <span className="block text-xs text-black/50">Optional — complements the rider call. Requires an SMS provider.</span>
          </span>
          <Toggle on={s.sms_notify_stores} onChange={(v) => set('sms_notify_stores', v)} />
        </label>
      </Card>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !supabase}
          className="rounded-lg bg-brand-green px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-green-700">✓ Saved</span>}
        {!supabase && <span className="text-xs text-black/40">Connect Supabase to save.</span>}
      </div>
    </div>
  );
}

function ServiceRow({ label, desc, on, onChange }:
  { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-3">
      <span>
        <span className="block text-sm font-medium">{label} <span className={`ml-1 text-xs font-normal ${on ? 'text-green-700' : 'text-black/40'}`}>{on ? 'On' : 'Off'}</span></span>
        <span className="block text-xs text-black/50">{desc}</span>
      </span>
      <Toggle on={on} onChange={onChange} />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-black/70">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-brand-green' : 'bg-black/20'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
