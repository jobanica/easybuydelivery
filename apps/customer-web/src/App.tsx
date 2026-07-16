import { useMemo, useState } from 'react';
import { commission, type FeePayer } from '@ebd/shared';
import { buildPadalaOrderRow, createPadalaOrder, type PadalaRequestInput } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';

const DEFAULT_DELIVERY_FEE = 50;

export function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-brand-green text-white">
        <div className="mx-auto max-w-xl px-5 py-4">
          <h1 className="text-xl font-bold tracking-tight">Easy Buy Delivery</h1>
          <p className="text-sm/5 opacity-90">Padala — send a package across town</p>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-6">
        <PadalaForm />
      </main>
    </div>
  );
}

interface FormState {
  itemDescription: string;
  deliveryFee: number;
  feePayer: FeePayer;
  pickupContact: string;
  dropoffContact: string;
  customerContact: string;
  notes: string;
}

const initial: FormState = {
  itemDescription: '',
  deliveryFee: DEFAULT_DELIVERY_FEE,
  feePayer: 'sender',
  pickupContact: '',
  dropoffContact: '',
  customerContact: '',
  notes: '',
};

function PadalaForm() {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live commission preview from the shared pricing layer (15% of DF for Padala).
  const operatorCut = useMemo(
    () => commission({ deliveryFee: form.deliveryFee, storeCount: 0 }),
    [form.deliveryFee],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toInput(): PadalaRequestInput {
    return {
      // In production these come from the authenticated customer session.
      customerId: 'preview-customer',
      customerContact: form.customerContact,
      deliveryFee: form.deliveryFee,
      feePayer: form.feePayer,
      itemDescription: form.itemDescription,
      pickup: { contact: form.pickupContact },
      dropoff: { contact: form.dropoffContact },
      notes: form.notes,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (supabase && isSupabaseConfigured) {
        const id = await createPadalaOrder(supabase, toInput());
        setCreatedId(id);
      } else {
        // No backend configured — validate the row locally and show a preview id.
        buildPadalaOrderRow(toInput());
        setCreatedId('preview-only');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (createdId) {
    return <OrderCreated id={createdId} onReset={() => { setForm(initial); setCreatedId(null); }} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!isSupabaseConfigured && (
        <p className="rounded-lg border border-brand-yellow bg-brand-yellow/20 px-3 py-2 text-sm">
          Preview mode — set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to submit real orders.
        </p>
      )}

      <Field label="What are we sending?">
        <input
          className={inputCls}
          value={form.itemDescription}
          onChange={(e) => set('itemDescription', e.target.value)}
          placeholder="e.g. Documents, small parcel"
          required
        />
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

      <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-black/5">
        <Row label="Delivery fee" value={`₱${form.deliveryFee.toFixed(2)}`} />
        <Row label="Operator commission (15%)" value={`₱${operatorCut.toFixed(2)}`} muted />
        <p className="mt-2 text-xs text-black/50">
          Padala is delivery-fee only — no goods are purchased.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting}
        className="w-full rounded-lg bg-brand-green py-3 font-semibold text-white
                   transition hover:brightness-95 disabled:opacity-60">
        {submitting ? 'Sending…' : 'Request a rider'}
      </button>
    </form>
  );
}

function OrderCreated({ id, onReset }: { id: string; onReset: () => void }) {
  return (
    <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center
                      rounded-full bg-brand-green/15 text-2xl">✓</div>
      <h2 className="text-lg font-bold">Padala request sent</h2>
      <p className="mt-1 text-sm text-black/60">
        {id === 'preview-only'
          ? 'Preview only — connect Supabase to notify riders.'
          : 'Available riders have been notified. You will get updates as it moves.'}
      </p>
      <p className="mt-2 font-mono text-xs text-black/40">{id}</p>
      <button onClick={onReset}
        className="mt-5 rounded-lg border border-brand-purple px-4 py-2 text-sm
                   font-medium text-brand-purple hover:bg-brand-purple/5">
        Send another
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm ' +
  'outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-black/70">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className={muted ? 'text-black/50' : ''}>{label}</span>
      <span className={muted ? 'text-black/50' : 'font-semibold'}>{value}</span>
    </div>
  );
}
