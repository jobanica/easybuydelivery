import { useState, type ReactNode } from 'react';
import { sendOtp, verifyOtp } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from './AuthContext.tsx';
import { inputCls } from '../ui.tsx';

/**
 * Gate the app behind phone OTP sign-in when a backend is configured. In preview
 * mode `authed` is always true, so this renders children directly.
 *
 * Phone OTP requires an SMS provider on the Supabase project. Set one up
 * (Auth → Providers → Phone) before this can deliver codes in production.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { live, authed } = useAuth();
  if (!live || authed) return <>{children}</>;
  return <OtpSignIn />;
}

function OtpSignIn() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Normalize a PH mobile (09xx…) to E.164 (+639xx…).
  const e164 = phone.startsWith('+') ? phone : phone.replace(/^0/, '+63');

  async function send() {
    setError(null); setBusy(true);
    try {
      await sendOtp(supabase!, { phone: e164 });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function verify() {
    setError(null); setBusy(true);
    try {
      await verifyOtp(supabase!, { phone: e164 }, code.trim());
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
          <p className="text-sm/5 opacity-90">Sign in to order</p>
        </div>
      </header>
      <main className="mx-auto max-w-sm px-5 py-8">
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          {!sent ? (
            <>
              <label className="mb-1 block text-sm font-medium text-black/70">Mobile number</label>
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="0917 123 4567" inputMode="tel" />
              <button onClick={send} disabled={busy || phone.length < 7}
                className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <label className="mb-1 block text-sm font-medium text-black/70">Enter the 6-digit code</label>
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
