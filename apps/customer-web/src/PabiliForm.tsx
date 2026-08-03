import { useEffect, useMemo, useState } from 'react';
import { validateBudget, resolveDeliveryFee, DEFAULT_DISTANCE_FEE_CONFIG,
  type DeliveryFeeModel, type DistanceFeeConfig,
  errMessage,
} from '@ebd/shared';
import { buildPabiliOrderRow, createPabiliOrder, getAppSettings, pabiliItemsSummary,
  type PabiliRequestInput, type PabiliItemInput } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { Field, Row, inputCls, peso, PaymentChoice, type PayChoice } from './ui.tsx';
import { LocationPicker, type LatLngValue } from './LocationPicker.tsx';
import { AreaPicker, kmBetween } from './AreaPicker.tsx';
import type { AreaSelection } from '@ebd/supabase';
import { useAuth } from './auth/AuthContext.tsx';

interface FormState {
  items: PabiliItemInput[];
  where: string;
  estimate: number;
  cap: number;
  customerContact: string;
  notes: string;
  pay: PayChoice | null;
}

const initial: FormState = {
  items: [{ qty: 1, name: '' }], where: '', estimate: 300, cap: 400,
  customerContact: '', notes: '', pay: null,
};

export function PabiliForm() {
  const { ensureContact } = useAuth();
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Convenience fee is operator-set (from app settings); the customer can't edit it.
  const [convenienceFee, setConvenienceFee] = useState(0);
  const [buyAt, setBuyAt] = useState<LatLngValue | null>(null);   // where to buy
  const [dropoff, setDropoff] = useState<LatLngValue | null>(null); // deliver to
  const [area, setArea] = useState<AreaSelection | null>(null);
  const [areaRequired, setAreaRequired] = useState(false);
  const [serviceArea, setServiceArea] = useState<{ lat: number; lng: number; radiusKm: number } | null>(null);
  // Delivery pricing comes from the operator's settings — recalculated from the
  // pinned distance under per-km pricing, never typed by the customer.
  const [feeCfg, setFeeCfg] = useState<{ model: DeliveryFeeModel; flatFee: number; distance: DistanceFeeConfig }>(
    { model: 'flat', flatFee: 50, distance: DEFAULT_DISTANCE_FEE_CONFIG });

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;
    getAppSettings(supabase).then((s) => {
      setConvenienceFee(s.convenience_fee_pabili ?? s.convenience_fee);
      setFeeCfg({
        model: s.delivery_fee_model,
        flatFee: s.default_delivery_fee,
        distance: { baseFare: s.delivery_base_fare, baseKm: s.delivery_base_km, perKm: s.delivery_per_km },
      });
        if (s.service_center_lat != null && s.service_center_lng != null && Number(s.service_radius_km) > 0) {
          setServiceArea({ lat: s.service_center_lat, lng: s.service_center_lng, radiusKm: Number(s.service_radius_km) });
        }

    }).catch(() => {});
  }, []);

  const deliveryFee = useMemo(() => resolveDeliveryFee({
    model: feeCfg.model, flatFee: feeCfg.flatFee, distanceConfig: feeCfg.distance,
    storeLocations: [buyAt], dropoff,
  }), [feeCfg, buyAt, dropoff]);
  // Per-km pricing needs both pins to measure the leg.
  const needsPinsForFee = feeCfg.model === 'per_km' && (!buyAt || !dropoff);
  // What the customer actually pays: goods (estimate for now) + fees. The final
  // amount follows the rider's real receipt, capped by their spending cap.
  const estimatedTotal = form.estimate + deliveryFee + convenienceFee;
  const maxTotal = form.cap + deliveryFee + convenienceFee;
  const capValid = form.cap >= form.estimate;
  const hasItems = form.items.some((i) => i.name.trim() !== '');

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setItem(i: number, patch: Partial<PabiliItemInput>) {
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  }
  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { qty: 1, name: '' }] }));
  }
  function removeItem(i: number) {
    setForm((f) => ({
      ...f,
      items: f.items.length === 1 ? [{ qty: 1, name: '' }] : f.items.filter((_, j) => j !== i),
    }));
  }

  function toInput(customerId: string): PabiliRequestInput {
    return {
      customerId,
      customerContact: form.customerContact,
      deliveryFee,
      convenienceFee,
      itemsDescription: pabiliItemsSummary(form.items),
      items: form.items,
      estimate: form.estimate,
      cap: form.cap,
      where: form.where,
      areaProvince: area?.province,
      areaCity: area?.city,
      areaBarangay: area?.barangay,
      pickupLat: buyAt?.lat,
      pickupLng: buyAt?.lng,
      deliveryLat: dropoff?.lat,
      deliveryLng: dropoff?.lng,
      notes: form.notes,
      paymentMethod: form.pay ?? 'cod',
      paid: form.pay === 'online',
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard against double taps
    setError(null);
    if (!hasItems) { setError('Please add at least one item to buy.'); return; }
    if (!form.pay) { setError('Please choose a payment method.'); return; }
    if (!dropoff) { setError('Please pin where the order should be delivered.'); return; }
    if (needsPinsForFee) { setError('Please pin where to buy so we can compute the delivery fee.'); return; }
    if (areaRequired && !area) { setError('Please choose your delivery area (province, city, barangay).'); return; }
    // The barangay is self-declared, so check the pin itself against the
    // operator's service radius (also enforced in the database).
    if (serviceArea && dropoff) {
      const km = kmBetween(serviceArea, dropoff);
      if (km > serviceArea.radiusKm) {
        setError(`That drop-off is about ${km.toFixed(1)} km away, outside our ${serviceArea.radiusKm} km delivery area. Please pin a location we serve.`);
        return;
      }
    }
    try {
      validateBudget({ estimate: form.estimate, cap: form.cap });
    } catch (err) {
      setError(errMessage(err));
      return;
    }
    setSubmitting(true);
    try {
      if (supabase && isSupabaseConfigured) {
        const customerId = await ensureContact(form.customerContact);
        setCreatedId(await createPabiliOrder(supabase, toInput(customerId)));
      } else {
        buildPabiliOrderRow(toInput('preview-customer'));
        setCreatedId('preview-only');
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (createdId) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">✓</div>
        <h2 className="text-lg font-bold">Pabili request sent</h2>
        <p className="mt-1 text-sm text-black/60">
          {createdId === 'preview-only'
            ? 'Preview only — connect Supabase to notify riders.'
            : 'A rider will buy your items and deliver them.'}
        </p>
        <p className="mt-2 font-mono text-xs text-black/40">{createdId}</p>
        <button onClick={() => { setForm(initial); setBuyAt(null); setDropoff(null); setArea(null); setCreatedId(null); }}
          className="mt-5 rounded-lg border border-brand-purple px-4 py-2 text-sm font-medium text-brand-purple hover:bg-brand-purple/5">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <span className="mb-1 block text-sm font-medium text-black/70">What should we buy?</span>
        <div className="space-y-2">
          {form.items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input type="number" min={1} value={it.qty} aria-label={`Quantity for item ${i + 1}`}
                onChange={(e) => setItem(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                className="w-16 shrink-0 rounded-lg border border-black/10 bg-white px-2 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30 text-center" />
              <input value={it.name} aria-label={`Item ${i + 1}`}
                onChange={(e) => setItem(i, { name: e.target.value })}
                placeholder={i === 0 ? 'e.g. paracetamol 500mg' : 'Another item'}
                className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30" />
              <button type="button" onClick={() => removeItem(i)} aria-label={`Remove item ${i + 1}`}
                disabled={form.items.length === 1}
                className="shrink-0 rounded-lg border border-black/10 px-3 text-sm text-black/40 disabled:opacity-30">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem}
          className="mt-2 w-full rounded-lg border border-dashed border-brand-purple/40 py-2 text-sm font-semibold text-brand-purple">
          ＋ Add more item
        </button>
        <p className="mt-1 text-xs text-black/40">
          One line per item so your rider can tick them off as they shop.
        </p>
      </div>
      <Field label="Where? (optional — leave blank for nearest store)">
        <input className={inputCls} value={form.where}
          onChange={(e) => set('where', e.target.value)} placeholder="e.g. Botica Central" />
      </Field>
      <AreaPicker value={area} onChange={setArea} onRequired={setAreaRequired} />
      <div>
        <span className="mb-1 block text-sm font-medium text-black/70">🛒 Where to buy{feeCfg.model !== 'per_km' && <span className="font-normal text-black/40"> (optional)</span>}</span>
        <LocationPicker value={buyAt} onChange={setBuyAt} />
        <p className="mt-1 text-xs text-black/40">{feeCfg.model === 'per_km' ? 'Needed to compute the delivery fee by distance.' : 'Pin the store if you have one in mind — otherwise the rider picks the nearest.'}</p>
      </div>
      <div>
        <span className="mb-1 block text-sm font-medium text-black/70">📍 Deliver to</span>
        <LocationPicker value={dropoff} onChange={setDropoff} />
        <p className="mt-1 text-xs text-black/40">Tap or drag the pin to where the rider should deliver.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Estimated cost (₱)">
          <input type="number" min={0} className={inputCls} value={form.estimate}
            onChange={(e) => set('estimate', Number(e.target.value))} required />
        </Field>
        <Field label="Spending cap (₱)">
          <input type="number" min={0} className={inputCls} value={form.cap}
            onChange={(e) => set('cap', Number(e.target.value))} required />
        </Field>
      </div>
      {!capValid && <p className="text-xs text-red-600">Cap must be at least the estimate.</p>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Delivery fee (₱)">
          <div className={`${inputCls} flex items-center justify-between bg-black/[0.03]`}>
            <span className="font-semibold">{needsPinsForFee ? '—' : peso(deliveryFee)}</span>
            <span className="text-xs text-black/40">{feeCfg.model === 'per_km' ? 'by distance' : 'flat rate'}</span>
          </div>
        </Field>
        <Field label="Your mobile number">
          <input className={inputCls} value={form.customerContact}
            onChange={(e) => set('customerContact', e.target.value)}
            placeholder="09xx xxx xxxx" required />
        </Field>
      </div>
      <Field label="Notes for the rider">
        <textarea className={inputCls} rows={2} value={form.notes}
          onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <PaymentChoice value={form.pay} onChange={(v) => set('pay', v)} />

      <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-black/5">
        <Row label="Estimated goods" value={peso(form.estimate)} />
        <Row label={feeCfg.model === 'per_km' ? 'Delivery fee (by distance)' : 'Delivery fee'} value={needsPinsForFee ? '—' : peso(deliveryFee)} />
        {convenienceFee > 0 && <Row label="Convenience fee" value={peso(convenienceFee)} />}
        <div className="mt-1 flex justify-between border-t border-black/10 pt-2 text-sm font-bold">
          <span>Estimated total to pay</span>
          <span>{needsPinsForFee ? '—' : peso(estimatedTotal)}</span>
        </div>
        <Row label={`Most you'd pay (at your ${peso(form.cap)} cap)`} value={needsPinsForFee ? '—' : peso(maxTotal)} muted />
        <p className="mt-2 text-xs text-black/50">
          The goods amount is an estimate — you pay the <b>actual receipt total</b> plus the
          delivery fee{convenienceFee > 0 ? ' and convenience fee' : ''}. The rider won't go over
          your cap without checking with you first.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting || !hasItems || !capValid || !form.pay || !dropoff || needsPinsForFee || (areaRequired && !area)}
        className="w-full rounded-lg bg-brand-green py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-60">
        {submitting ? 'Sending…'
          : !hasItems ? 'Add what to buy'
          : areaRequired && !area ? 'Choose your delivery area'
          : needsPinsForFee || !dropoff ? 'Pin both locations'
          : !form.pay ? 'Choose a payment method'
          : `Request Pabili · about ${peso(estimatedTotal)}`}
      </button>
    </form>
  );
}
