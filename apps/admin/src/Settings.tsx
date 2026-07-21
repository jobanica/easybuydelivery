import { useEffect, useState } from 'react';
import { getAppSettings, updateAppSettings, type AppSettings } from '@ebd/supabase';
import { commission } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { Card, Muted, peso } from './ui.tsx';

const SAMPLE: AppSettings = {
  is_open: true, schedule: null, default_delivery_fee: 50, per_store_fee: 25,
  convenience_fee: 0, commission_rate: 0.15, delivery_fee_model: 'flat',
  convenience_fee_mode: 'pass_through', settlement_cutoff: '00:00', sms_notify_stores: false,
};

const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

export function Settings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    { perStoreFee: s.per_store_fee, commissionRate: s.commission_rate, convenienceFee: s.convenience_fee, convenienceFeeMode: s.convenience_fee_mode },
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
          <Field label="Convenience fee (₱)">
            <input type="number" min={0} className={inp} value={s.convenience_fee}
              onChange={(e) => set('convenience_fee', Number(e.target.value))} />
          </Field>
          <Field label="Convenience fee handling">
            <select className={inp} value={s.convenience_fee_mode}
              onChange={(e) => set('convenience_fee_mode', e.target.value as AppSettings['convenience_fee_mode'])}>
              <option value="pass_through">Pass-through to admin</option>
              <option value="in_base">Inside the commission base</option>
            </select>
          </Field>
        </div>
        <p className="mt-4 rounded-lg bg-brand-green/10 px-3 py-2 text-sm text-green-800">
          Example: ₱{s.default_delivery_fee} delivery + {peso(s.per_store_fee)}×2 added stores →
          commission <span className="font-bold">{peso(example)}</span>
        </p>
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
