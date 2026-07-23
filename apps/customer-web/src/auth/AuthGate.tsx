import { useState, type ReactNode } from 'react';
import { sendOtp, verifyOtp } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from './AuthContext.tsx';
import { inputCls } from '../ui.tsx';

/**
 * Require a phone-verified account before ordering. In preview mode `authed`
 * is always true, so this renders children directly.
 *
 * Phone OTP needs an SMS provider on the Supabase project (Auth → Providers →
 * Phone, or a Send-SMS hook) to deliver real codes.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { live, authed, ensureContact } = useAuth();
  if (!live || authed) return <>{children}</>;
  return <OtpSignIn onVerified={(name) => name && void ensureContact('', name)} />;
}

function OtpSignIn({ onVerified }: { onVerified: (name: string) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Normalize a PH mobile (09xx…) to E.164 (+639xx…).
  const e164 = phone.startsWith('+') ? phone : phone.replace(/^0/, '+63');

  async function send() {
    setError(null); setBusy(true);
    try { await sendOtp(supabase!, { phone: e164 }); setSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function verify() {
    setError(null); setBusy(true);
    try {
      await verifyOtp(supabase!, { phone: e164 }, code.trim());
      onVerified(name.trim());
      // AuthContext's onAuthChange takes over from here.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen">
      <header className="bg-brand-green text-white">
        <div className="mx-auto max-w-sm px-5 py-4">
          <h1 className="text-xl font-bold">Easy Buy Delivery</h1>
          <p className="text-sm/5 opacity-90">Create your account to order</p>
        </div>
      </header>
      <main className="mx-auto max-w-sm px-5 py-8">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          {!sent ? (
            <>
              <label className="mb-1 block text-sm font-medium text-black/70">Your name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Juan Dela Cruz" />
              <label className="mb-1 mt-4 block text-sm font-medium text-black/70">Mobile number</label>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="0917 123 4567" inputMode="tel" />
              <button onClick={send} disabled={busy || phone.length < 7}
                className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <p className="mb-1 text-sm text-black/60">We texted a 6-digit code to <b>{phone}</b>.</p>
              <label className="mb-1 mt-3 block text-sm font-medium text-black/70">Enter the code</label>
              <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="••••••" inputMode="numeric" maxLength={6} />
              <button onClick={verify} disabled={busy || code.length < 4}
                className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
              <button onClick={() => { setSent(false); setCode(''); }}
                className="mt-2 w-full text-sm text-brand-purple">Use a different number</button>
            </>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
        <p className="mt-3 text-center text-xs text-black/40">
          We'll text you a one-time code. Standard rates may apply.
        </p>
      </main>
    </div>
  );
}
