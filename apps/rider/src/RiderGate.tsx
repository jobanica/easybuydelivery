import { useEffect, useState } from 'react';
import { onAuthChange, sendEmailOtp, ensureRider, signOut } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { App } from './App.tsx';

/**
 * Rider auth + onboarding gate.
 *  - Preview mode (no backend): render the app with sample data.
 *  - Live: email magic-link sign-in → apply (name, phone, vehicle) → show
 *    status until an admin approves.
 */
export function RiderGate() {
  if (!isSupabaseConfigured || !supabase) return <App />;
  return <LiveGate />;
}

const inp = 'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/30';

function LiveGate() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [rider, setRider] = useState<{ id: string; application_status: string; name?: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [screen, setScreen] = useState<'landing' | 'signin'>('landing');

  useEffect(() => onAuthChange(supabase!, (u) => setUserId(u?.id ?? null)), []);

  // Load this rider's application/status once signed in.
  useEffect(() => {
    if (!userId) { setRider(null); setChecked(false); return; }
    setChecked(false);
    supabase!.from('riders').select('id, application_status, name').eq('profile_id', userId).maybeSingle()
      .then(({ data }) => { setRider((data as { id: string; application_status: string; name?: string } | null) ?? null); setChecked(true); });
  }, [userId]);

  if (userId === undefined) {
    return <Shell title="Loading…" sub="Rider access"><p className="text-sm text-black/50">Please wait…</p></Shell>;
  }
  if (!userId) {
    return screen === 'signin'
      ? <EmailSignIn onBack={() => setScreen('landing')} />
      : <Landing onStart={() => setScreen('signin')} />;
  }
  if (!checked) {
    return <Shell title="Loading…" sub="Rider access"><p className="text-sm text-black/50">Please wait…</p></Shell>;
  }
  if (!rider) return <Onboard onDone={setRider} />;
  if (rider.application_status === 'approved') return <App riderId={rider.id} riderName={rider.name} />;
  return <StatusScreen status={rider.application_status} />;
}

/** First-run welcome screen. */
function Landing({ onStart }: { onStart: () => void }) {
  const [learn, setLearn] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f4]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col px-6 pt-10">
        <h1 className="text-4xl font-black leading-tight tracking-tight">
          Deliver faster,<br /><span className="text-brand-green">earn smarter</span>
        </h1>
        <p className="mt-3 text-sm text-black/55">
          Accept orders across your town and earn on your own schedule with Easy Buy Delivery.
        </p>

        <div className="flex flex-1 items-center justify-center py-6">
          <div className="relative flex h-52 w-52 items-center justify-center rounded-full bg-gradient-to-br from-brand-green to-brand-purple shadow-xl">
            <span className="absolute -right-2 -top-1 h-16 w-16 rounded-full bg-brand-yellow/40 blur-xl" />
            <span className="text-[6rem] leading-none">🛵</span>
          </div>
        </div>

        {learn && (
          <div className="mb-4 rounded-2xl bg-white p-4 text-sm text-black/60 shadow-sm ring-1 ring-black/5">
            <p className="font-semibold text-brand-ink">How it works</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Sign in with your email, then apply with your name, phone, and vehicle.</li>
              <li>Once an admin approves you, go online to receive nearby orders.</li>
              <li>You keep the delivery &amp; convenience fees — a small commission is settled daily.</li>
            </ul>
          </div>
        )}

        <div className="space-y-3 pb-8">
          <button onClick={onStart}
            className="w-full rounded-2xl bg-brand-green py-3.5 font-bold text-white shadow-sm transition hover:brightness-95">
            Login &amp; Start Riding
          </button>
          <button onClick={onStart}
            className="w-full rounded-2xl bg-brand-purple py-3.5 font-bold text-white shadow-sm transition hover:brightness-95">
            Join Us Now
          </button>
          <button onClick={() => setLearn((v) => !v)}
            className="w-full rounded-2xl bg-white py-3.5 font-bold text-brand-ink ring-1 ring-black/10 transition hover:bg-black/[0.02]">
            {learn ? 'Hide details' : 'Learn More'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="bg-brand-purple text-white">
        <div className="mx-auto max-w-sm px-5 py-4">
          <h1 className="text-lg font-bold">Easy Buy Rider</h1>
          <p className="text-xs opacity-90">{sub}</p>
        </div>
      </header>
      <main className="mx-auto max-w-sm px-5 py-8">
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="mb-3 font-bold">{title}</h2>
          {children}
        </div>
      </main>
    </div>
  );
}

function EmailSignIn({ onBack }: { onBack: () => void }) {
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
    <Shell title={sent ? 'Check your email' : 'Sign in'} sub="Rider access">
      {!sent ? (
        <>
          <button onClick={onBack} className="mb-3 text-sm font-medium text-brand-purple">← Back</button>
          <label className="mb-1 block text-sm font-medium text-black/70">Your email</label>
          <input className={inp} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" inputMode="email" autoCapitalize="none" />
          <button disabled={busy || !valid} onClick={send}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Continue with email'}
          </button>
          <p className="mt-3 text-xs text-black/40">We'll email you a secure sign-in link. No password needed.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-black/60">We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to continue.</p>
          <button disabled={busy} onClick={send}
            className="mt-4 w-full rounded-lg border border-brand-purple py-2.5 text-sm font-medium text-brand-purple disabled:opacity-60">
            {busy ? 'Resending…' : 'Resend link'}
          </button>
          <button onClick={() => setSent(false)} className="mt-2 w-full text-sm text-black/50">Use a different email</button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Shell>
  );
}

function Onboard({ onDone }: { onDone: (r: { id: string; application_status: string }) => void }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true); setError(null);
    try { onDone(await ensureRider(supabase!, { name, mobile, vehicle })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Apply as a rider" sub="Tell us about you">
      <div className="space-y-3">
        <input className={inp} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp} placeholder="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
        <input className={inp} placeholder="Vehicle (e.g. motorcycle)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
      </div>
      <button disabled={busy || !name || !mobile} onClick={apply}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
      <button onClick={() => void signOut(supabase!)} className="mt-2 w-full text-sm text-black/50">Sign out</button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Shell>
  );
}

function StatusScreen({ status }: { status: string }) {
  const rejected = status === 'rejected';
  return (
    <Shell title={rejected ? 'Application rejected' : 'Application pending'} sub="Onboarding">
      <p className="text-sm text-black/60">
        {rejected
          ? 'Your rider application was not approved. Contact the operator for details.'
          : 'Thanks for applying! An admin will review your application. You can accept orders once approved.'}
      </p>
      <button onClick={() => void signOut(supabase!)}
        className="mt-4 w-full rounded-lg border border-brand-purple py-2.5 text-sm font-medium text-brand-purple">
        Sign out
      </button>
    </Shell>
  );
}
