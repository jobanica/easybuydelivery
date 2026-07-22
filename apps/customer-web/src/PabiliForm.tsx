import { useMemo, useState } from 'react';
import { pabiliCommission, validateBudget } from '@ebd/shared';
import { buildPabiliOrderRow, createPabiliOrder, type PabiliRequestInput } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { Field, Row, inputCls, peso, PaymentChoice, type PayChoice } from './ui.tsx';
import { useAuth } from './auth/AuthContext.tsx';

interface FormState {
  itemsDescription: string;
  where: string;
  estimate: number;
  cap: number;
  deliveryFee: number;
  customerContact: string;
  notes: string;
  pay: PayChoice;
}

const initial: FormState = {
  itemsDescription: '', where: '', estimate: 300, cap: 400,
  deliveryFee: 50, customerContact: '', notes: '', pay: 'cod',
};

export function PabiliForm() {
  const { ensureContact } = useAuth();
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const operatorCut = useMemo(() => pabiliCommission(form.deliveryFee), [form.deliveryFee]);
  const capValid = form.cap >= form.estimate;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toInput(customerId: string): PabiliRequestInput {
    return {
      customerId,
      customerContact: form.customerContact,
      deliveryFee: form.deliveryFee,
      itemsDescription: form.itemsDescription,
      estimate: form.estimate,
      cap: form.cap,
      where: form.where,
      notes: form.notes,
      paymentMethod: form.pay === 'online' ? 'online' : 'cod',
      paid: form.pay === 'online',
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      validateBudget({ estimate: form.estimate, cap: form.cap });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
        <button onClick={() => { setForm(initial); setCreatedId(null); }}
          className="mt-5 rounded-lg border border-brand-purple px-4 py-2 text-sm font-medium text-brand-purple hover:bg-brand-purple/5">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="What should we buy?">
        <textarea className={inputCls} rows={3} value={form.itemsDescription}
          onChange={(e) => set('itemsDescription', e.target.value)}
          placeholder="e.g. 2x paracetamol, 1L fresh milk, a bouquet" required />
      </Field>
      <Field label="Where? (optional — leave blank for nearest store)">
        <input className={inputCls} value={form.where}
          onChange={(e) => set('where', e.target.value)} placeholder="e.g. Botica Central" />
      </Field>
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
          <input type="number" min={0} className={inputCls} value={form.deliveryFee}
            onChange={(e) => set('deliveryFee', Number(e.target.value))} required />
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
        <Row label="Spending cap" value={peso(form.cap)} muted />
        <Row label="Delivery fee" value={peso(form.deliveryFee)} />
        <Row label="Operator commission (15% of DF)" value={peso(operatorCut)} muted />
        <p className="mt-2 text-xs text-black/50">
          You pay the actual receipt total + delivery fee. The rider won't exceed
          your cap without checking with you.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={submitting || !capValid}
        className="w-full rounded-lg bg-brand-green py-3 font-semibold text-white transition hover:brightness-95 disabled:opacity-60">
        {submitting ? 'Sending…' : 'Request Pabili'}
      </button>
    </form>
  );
}
