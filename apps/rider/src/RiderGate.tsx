import { useEffect, useState } from 'react';
import { onAuthChange, sendOtp, verifyOtp, ensureRider, signOut } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { App } from './App.tsx';
import { REQUIRE_ACCOUNT } from './config.ts';

/**
 * Rider auth + onboarding gate.
 *  - Preview mode (no backend): render the app with sample data.
 *  - Live: phone OTP sign-in → ensureRider → show status until approved.
 *
 * Phone OTP needs an SMS provider on the Supabase project.
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

  useEffect(() => onAuthChange(supabase!, (u) => setUserId(u?.id ?? null)), []);

  // OTP off: start a background anonymous session so there's no sign-in screen.
  useEffect(() => {
    if (REQUIRE_ACCOUNT || userId !== null) return;
    void supabase!.auth.signInAnonymously().catch(() => {});
  }, [userId]);

  // Load this rider's application/status once signed in (so approved riders
  // go straight to the app instead of re-applying every time).
  useEffect(() => {
    if (!userId) { setRider(null); setChecked(userId === null && REQUIRE_ACCOUNT); return; }
    setChecked(false);
    supabase!.from('riders').select('id, application_status, name').eq('profile_id', userId).maybeSingle()
      .then(({ data }) => { setRider((data as { id: string; application_status: string; name?: string } | null) ?? null); setChecked(true); });
  }, [userId]);

  if (userId === undefined || (userId && !checked) || (!userId && !REQUIRE_ACCOUNT)) {
    return <Shell title="Loading…" sub="Rider access"><p className="text-sm text-black/50">Please wait…</p></Shell>;
  }
  if (!userId) return <OtpSignIn />;
  if (!rider) return <Onboard onDone={setRider} />;
  if (rider.application_status === 'approved') return <App riderId={rider.id} riderName={rider.name} />;
  return <StatusScreen status={rider.application_status} />;
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

function OtpSignIn() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e164 = phone.startsWith('+') ? phone : phone.replace(/^0/, '+63');

  async function run(fn: () => Promise<void>) {
    setError(null); setBusy(true);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Sign in" sub="Rider access">
      {!sent ? (
        <>
          <input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="0917 123 4567" inputMode="tel" />
          <button disabled={busy || phone.length < 7} onClick={() => run(async () => { await sendOtp(supabase!, { phone: e164 }); setSent(true); })}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </>
      ) : (
        <>
          <input className={inp} value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="••••••" inputMode="numeric" maxLength={6} />
          <button disabled={busy || code.length < 4} onClick={() => run(() => verifyOtp(supabase!, { phone: e164 }, code.trim()).then(() => {}))}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
            {busy ? 'Verifying…' : 'Verify & continue'}
          </button>
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
        <input className={inp} placeholder="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        <input className={inp} placeholder="Vehicle (e.g. motorcycle)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
      </div>
      <button disabled={busy || !name || !mobile} onClick={apply}
        className="mt-4 w-full rounded-lg bg-brand-green py-3 font-semibold text-white disabled:opacity-60">
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
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
