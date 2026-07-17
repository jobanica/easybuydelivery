export const inputCls =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm ' +
  'outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-black/70">{label}</span>
      {children}
    </label>
  );
}

export function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className={muted ? 'text-black/50' : ''}>{label}</span>
      <span className={muted ? 'text-black/50' : 'font-semibold'}>{value}</span>
    </div>
  );
}

export const peso = (n: number) => `₱${n.toFixed(2)}`;

export type PayChoice = 'cod' | 'online';

/** Payment method selector shared across the ordering flows. */
export function PaymentChoice({ value, onChange }:
  { value: PayChoice; onChange: (v: PayChoice) => void }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-black/70">Payment</span>
      <div className="grid grid-cols-2 gap-2">
        {(['cod', 'online'] as const).map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
              value === opt
                ? 'bg-brand-green text-white ring-brand-green'
                : 'bg-white text-black/60 ring-black/10'
            }`}>
            {opt === 'cod' ? 'Cash on delivery' : 'Pay online'}
          </button>
        ))}
      </div>
      {value === 'online' && (
        <p className="mt-1 text-xs text-black/50">
          You'll pay the delivery fee online now; the rider is reimbursed for
          goods at the door. (Demo — real GCash/Maya via PayMongo needs API keys.)
        </p>
      )}
    </div>
  );
}
