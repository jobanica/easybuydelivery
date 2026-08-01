import { useMemo, useState } from 'react';
import { commission, type FeePayer } from '@ebd/shared';
import { buildPadalaOrderRow, createPadalaOrder, type PadalaRequestInput } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { Field, Row, inputCls, peso, PaymentChoice, type PayChoice } from './ui.tsx';
import { useAuth } from './auth/AuthContext.tsx';

const DEFAULT_DELIVERY_FEE = 50;

interface FormState {
  itemDescription: string;
  deliveryFee: number;
  feePayer: FeePayer;
  pickupContact: string;
  dropoffContact: string;
  customerContact: string;
  notes: string;
  pay: PayChoice;
}

const initial: FormState = {
  itemDescription: '', deliveryFee: DEFAULT_DELIVERY_FEE, feePayer: 'sender',
  pickupContact: '', dropoffContact: '', customerContact: '', notes: '', pay: 'cod',
};

export function PadalaForm() {
  const { ensureContact } = useAuth();
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const operatorCut = useMemo(
    () => commission({ deliveryFee: form.deliveryFee, storeCount: 0 }),
    [form.deliveryFee],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toInput(customerId: string): PadalaRequestInput {
    return {
      customerId,
      customerContact: form.customerContact,
      deliveryFee: form.deliveryFee,
      feePayer: form.feePayer,
      itemDescription: form.itemDescription,
      pickup: { contact: form.pickupContact },
      dropoff: { contact: form.dropoffContact },
      notes: form.notes,
      paymentMethod: form.pay === 'online' ? 'online' : 'cod',
      paid: form.pay === 'online',
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard against double taps
    setError(null);
    setSubmitting(true);
    try {
      if (supabase && isSupabaseConfigured) {
        const customerId = await ensureContact(form.customerContact);
        setCreatedId(await createPadalaOrder(supabase, toInput(customerId)));
      } else {
        buildPadalaOrderRow(toInput('preview-customer'));
        setCreatedId('preview-only');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (createdId) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">✓</div>
        <h2 className="text-lg font-bold">Padala request sent</h2>
        <p className="mt-1 text-sm text-black/60">
          {createdId === 'preview-only'
            ? 'Preview only — connect Supabase to notify riders.'
            : 'Available riders have been notified.'}
        </p>
        <p className="mt-2 font-mono text-xs text-black/40">{createdId}</p>
        <button onClick={() => { setForm(initial); setCreatedId(null); }}
          className="mt-5 rounded-lg border border-brand-purple px-4 py-2 text-sm font-medium text-brand-purple hover:bg-brand-purple/5">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="What are we sending?">
        <input className={inputCls} value={form.itemDescription}
          onChange={(e) => set('itemDescription', e.target.value)}
          placeholder="e.g. Documents, small parcel" required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Pickup contact #">
          <input className={inputCls} value={form.pickupContact}
            onChange={(e) => set('pickupContact', e.target.value)} required />
        </Field>
        <Field label="Drop-off contact #">
          <input className={inputCls} value={form.dropoffContact}
            onChange={(e) => set('dropoffContact', e.target.value)} required />
        </Field>
      </div>
      <Field label="Your mobile number">
        <input className={inputCls} value={form.customerContact}
          onChange={(e) => set('customerContact', e.target.value)}
          placeholder="09xx xxx xxxx" required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Delivery fee (₱)">
          <input type="number" min={0} className={inputCls} value={form.deliveryFee}
            onChange={(e) => set('deliveryFee', Number(e.target.value))} required />
        </Field>
        <Field label="Who pays the fee?">
          <select className={inputCls} value={form.feePayer}
            onChange={(e) => set('feePayer', e.target.value as FeePayer)}>
            <option value="sender">Sender</option>
            <option value="receiver">Receiver</option>
          </select>
        </Field>
      </div>
      <Field label="Notes (size / weight / fragile)">
        <textarea className={inputCls} rows={2} value={form.notes}
          onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <PaymentChoice value={form.pay} onChange={(v) => set('pay', v)} />
      <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-black/5">
        <Row label="Delivery fee" value={peso(form.deliveryFee)} />
        <Row label="Operator commission (15%)" value={peso(operatorCut)} muted />
        <p className="mt-2 text-xs text-black/50">Padala is delivery-fee only — no goods are purchased.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting}
        className="w-full rounded-lg bg-brand-green py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-60">
        {submitting ? 'Sending…' : 'Request a rider'}
      </button>
    </form>
  );
}
