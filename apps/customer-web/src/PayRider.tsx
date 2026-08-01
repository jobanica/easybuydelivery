import { useEffect, useState } from 'react';
import { getOrderPayToRider, getAppSettings, uploadPaymentReceipt, setOrderPaymentReference, type OrderPayToRider } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';
import { Qr } from './Qr.tsx';
import { peso } from './ui.tsx';

/**
 * Pay-your-rider panel for GCash-to-rider orders: shows who/where to pay
 * (rider's GCash, or the operator's as fallback), a scannable QR, and lets the
 * sender upload proof of payment. Used on the Track screen and in Account.
 */
export function PayRider({ orderId }: { orderId: string }) {
  const [info, setInfo] = useState<OrderPayToRider | null>(null);
  const [operator, setOperator] = useState<{ number: string | null; name: string | null }>({ number: null, name: null });
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [reference, setReference] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savedRef, setSavedRef] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await getOrderPayToRider(supabase!, orderId);
        if (cancelled) return;
        setInfo(d);
        // Fall back to the operator's GCash when the rider has none on file.
        if (d && !d.payout_number) {
          const s = await getAppSettings(supabase!).catch(() => null);
          if (!cancelled && s) setOperator({ number: s.settlement_gcash_number, name: s.settlement_gcash_name });
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  const payNumber = info?.payout_number || operator.number || null;
  const payName = info?.payout_number ? `${info.rider_name} — your rider` : operator.name ? `${operator.name} (operator)` : info?.rider_name ?? '';

  async function upload(file: File) {
    if (!supabase) return;
    setUploading(true); setErr(null);
    try { setReceiptUrl(await uploadPaymentReceipt(supabase, orderId, file, reference.trim() || undefined)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }
  async function saveRef() {
    if (!supabase || !reference.trim()) return;
    setErr(null);
    try { await setOrderPaymentReference(supabase, orderId, reference.trim()); setSavedRef(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <h3 className="mb-2 font-bold">💸 Pay for your order</h3>
      {loading ? (
        <p className="py-2 text-sm text-black/50">Loading payment details…</p>
      ) : !info ? (
        <p className="py-2 text-sm text-black/55">Waiting for a rider to accept — payment details will appear here.</p>
      ) : !payNumber ? (
        <p className="py-2 text-sm text-black/55">Your rider ({info.rider_name}) hasn't set a GCash/Maya number yet. Please message them, or contact the operator.</p>
      ) : (
        <>
          <p className="text-sm">Send <b>{peso(info.amount)}</b> via GCash/Maya to:</p>
          <div className="mt-1 rounded-lg bg-brand-purple/[0.06] px-3 py-2">
            <p className="text-sm font-bold text-brand-ink">{payNumber}</p>
            <p className="text-xs text-black/55">{payName}</p>
          </div>

          <button onClick={() => setShowQr((v) => !v)}
            className="mt-2 rounded-lg bg-brand-purple px-3 py-1.5 text-xs font-semibold text-white">
            {showQr ? 'Hide QR' : '📱 Show payment QR'}
          </button>
          {showQr && (
            <div className="mt-2 flex flex-col items-center rounded-lg bg-white p-3 ring-1 ring-black/5">
              <Qr payload={`ebd://pay?to=${encodeURIComponent(payNumber)}&amount=${info.amount}`} />
              <p className="mt-2 text-center text-[11px] text-black/50">Scan with GCash/Maya, or send {peso(info.amount)} to {payNumber}.</p>
            </div>
          )}

          <label className="mt-3 block text-xs font-medium text-black/70">Reference number (optional)</label>
          <div className="mt-1 flex gap-2">
            <input value={reference} onChange={(e) => { setReference(e.target.value); setSavedRef(false); }}
              placeholder="GCash reference #"
              className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green" />
            <button onClick={saveRef} disabled={!reference.trim()}
              className="shrink-0 rounded-lg border border-brand-purple px-3 text-xs font-medium text-brand-purple disabled:opacity-50">
              {savedRef ? 'Saved' : 'Save'}
            </button>
          </div>

          <label className="mt-3 block text-xs font-medium text-black/70">Upload receipt / screenshot</label>
          {receiptUrl ? (
            <div className="mt-1 flex items-center gap-3">
              <img src={receiptUrl} alt="Receipt" className="h-20 w-20 rounded-lg object-cover ring-1 ring-black/10" />
              <span className="text-sm font-medium text-green-700">✓ Uploaded</span>
              <label className="cursor-pointer text-xs text-brand-purple underline">
                Replace
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
              </label>
            </div>
          ) : (
            <label className="mt-1 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-black/20 py-3 text-sm font-medium text-black/60">
              {uploading ? 'Uploading…' : '＋ Upload receipt'}
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            </label>
          )}
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <p className="mt-2 text-[11px] text-black/45">The rider/operator confirms your payment. The recipient pays nothing on delivery.</p>
        </>
      )}
    </div>
  );
}
