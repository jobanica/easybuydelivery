import { useEffect, useState, type ReactNode } from 'react';
import { signInWithPassword, signUpWithPassword, sendPasswordReset, updatePassword, onPasswordRecovery } from '@ebd/supabase';
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
  const [recovery, setRecovery] = useState(false);
  useEffect(() => { if (!supabase) return; return onPasswordRecovery(supabase, () => setRecovery(true)); }, []);
  if (!REQUIRE_ACCOUNT || !live) return <>{children}</>;
  if (recovery) return <SetNewPassword onDone={() => setRecovery(false)} />;
  if (loading) return <Splash sub="Loading…" />;
  if (!authed) return <EmailSignIn />;
  if (needsPhone) return <PhoneSetup />;
  return <>{children}</>;
}

/** Shown after the user opens a password-reset link. */
function SetNewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (password.length < 6) { setError('Use at least 6 characters.'); return; }
    setBusy(true); setError(null);
    try { await updatePassword(supabase!, password); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Shell title="Set a new password">
      <label className="mb-1 block text-sm font-medium text-black/70">New password</label>
      <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 6 characters" autoComplete="new-password"
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void save(); }} />
      <button onClick={save} disabled={busy}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Saving…' : 'Save new password'}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Shell>
  );
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
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const valid = mode === 'forgot' ? emailOk : emailOk && password.length >= 6;

  async function submit() {
    setError(null); setBusy(true);
    try {
      if (mode === 'forgot') { await sendPasswordReset(supabase!, email.trim(), window.location.origin); setSent(true); }
      else if (mode === 'signup') await signUpWithPassword(supabase!, email.trim(), password);
      else await signInWithPassword(supabase!, email.trim(), password);
      // The auth listener in AuthContext takes over on success.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'forgot') {
    return (
      <Shell title="Reset your password">
        {sent ? (
          <>
            <p className="text-sm text-black/60">If an account exists for <b>{email.trim()}</b>, we've sent a reset link. Open it on this device to set a new password.</p>
            <button onClick={() => { setMode('signin'); setSent(false); }}
              className="mt-4 w-full rounded-lg border border-brand-purple py-2.5 text-sm font-medium text-brand-purple">Back to sign in</button>
          </>
        ) : (
          <>
            <label className="mb-1 block text-sm font-medium text-black/70">Email</label>
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com" inputMode="email" autoCapitalize="none" autoComplete="email"
              onKeyDown={(e) => { if (e.key === 'Enter' && valid && !busy) void submit(); }} />
            <button onClick={submit} disabled={busy || !valid}
              className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button onClick={() => { setMode('signin'); setError(null); }} className="mt-4 w-full text-sm text-black/55">Back to sign in</button>
          </>
        )}
      </Shell>
    );
  }

  return (
    <Shell title={mode === 'signup' ? 'Create your account' : 'Sign in to order'}>
      <label className="mb-1 block text-sm font-medium text-black/70">Email</label>
      <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com" inputMode="email" autoCapitalize="none" autoComplete="email" />
      <label className="mb-1 mt-3 block text-sm font-medium text-black/70">Password</label>
      <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 6 characters"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        onKeyDown={(e) => { if (e.key === 'Enter' && valid && !busy) void submit(); }} />
      <button onClick={submit} disabled={busy || !valid}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      {mode === 'signin' && (
        <button onClick={() => { setMode('forgot'); setError(null); }} className="mt-3 w-full text-sm text-brand-purple">Forgot password?</button>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(null); }}
        className="mt-4 w-full text-sm text-black/55">
        {mode === 'signup' ? 'Already have an account? Sign in' : "New here? Create an account"}
      </button>
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
