import { useState, type ReactNode } from 'react';
import { sendEmailOtp } from '@ebd/supabase';
import { supabase } from '../lib/supabase.ts';
import { useAuth } from './AuthContext.tsx';
import { inputCls } from '../ui.tsx';
import { REQUIRE_ACCOUNT } from '../config.ts';

/**
 * Account gate. With REQUIRE_ACCOUNT on, a customer must sign in with their
 * email (magic link) and add a phone number before they can order. Preview mode
 * (`live` false) renders children directly.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { live, loading, authed, needsPhone } = useAuth();
  if (!REQUIRE_ACCOUNT || !live) return <>{children}</>;
  if (loading) return <Splash sub="Loading…" />;
  if (!authed) return <EmailSignIn />;
  if (needsPhone) return <PhoneSetup />;
  return <>{children}</>;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f7f4]">
      <header className="bg-brand-green text-white">
        <div className="mx-auto flex max-w-sm items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/20">
            <img src="/icons/pwa-512x512.png" alt="" className="h-8 w-8 object-contain" />
          </span>
          <div className="leading-tight">
            <h1 className="text-lg font-extrabold">Easy Buy Delivery</h1>
            <p className="text-xs opacity-90">{title}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-sm px-5 py-8">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">{children}</div>
      </main>
    </div>
  );
}

const Splash = ({ sub }: { sub: string }) => <Shell title={sub}><p className="text-sm text-black/50">Please wait…</p></Shell>;

function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /\S+@\S+\.\S+/.test(email.trim());

  async function send() {
    setError(null); setBusy(true);
    try { await sendEmailOtp(supabase!, email.trim(), window.location.origin); setSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Sign in to order">
      {!sent ? (
        <>
          <label className="mb-1 block text-sm font-medium text-black/70">Your email</label>
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" inputMode="email" autoCapitalize="none" />
          <button onClick={send} disabled={busy || !valid}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Continue with email'}
          </button>
          <p className="mt-3 text-xs text-black/40">We'll email you a secure sign-in link. No password needed.</p>
        </>
      ) : (
        <>
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/15 text-2xl">✉️</div>
          <h2 className="text-lg font-bold">Check your email</h2>
          <p className="mt-1 text-sm text-black/60">
            We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to continue.
          </p>
          <button onClick={send} disabled={busy}
            className="mt-4 w-full rounded-lg border border-brand-purple py-2.5 text-sm font-medium text-brand-purple disabled:opacity-60">
            {busy ? 'Resending…' : 'Resend link'}
          </button>
          <button onClick={() => { setSent(false); }} className="mt-2 w-full text-sm text-black/50">Use a different email</button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Shell>
  );
}

function PhoneSetup() {
  const { ensureContact, signOut, email } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (phone.trim().length < 7) { setError('Enter a valid mobile number.'); return; }
    setBusy(true); setError(null);
    try { await ensureContact(phone.trim(), name.trim() || undefined); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Shell title="One more step">
      <h2 className="text-lg font-bold">Add your phone number</h2>
      <p className="mt-1 text-sm text-black/60">Signed in as {email}. We need a number so your rider can reach you.</p>
      <label className="mb-1 mt-4 block text-sm font-medium text-black/70">Your name</label>
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Dela Cruz" />
      <label className="mb-1 mt-3 block text-sm font-medium text-black/70">Mobile number</label>
      <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0917 123 4567" inputMode="tel" />
      <button onClick={save} disabled={busy}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Saving…' : 'Save & continue'}
      </button>
      <button onClick={() => void signOut()} className="mt-2 w-full text-sm text-black/50">Sign out</button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Shell>
  );
}
