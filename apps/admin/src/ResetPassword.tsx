import { useState } from 'react';
import { resetRiderPassword, type RiderLogin } from '@ebd/supabase';
import { errMessage } from '@ebd/shared';
import { supabase } from './lib/supabase.ts';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

/**
 * Give a rider a way back in.
 *
 * There is no way to show a rider's existing password, and the console should
 * not pretend otherwise: Supabase keeps a bcrypt hash, so the original is not
 * stored anywhere to be read. What an operator actually needs when a rider
 * calls saying they cannot get in is a password the rider *can* use, read out
 * over the phone — which is this.
 *
 * Shown once, because nothing readable is kept. Losing it costs another reset,
 * which is cheap; keeping a copy would cost a readable credential that most
 * riders also use for their email.
 */
export function ResetPassword({ rider, login, onDone }: {
  rider: { id: string; name: string };
  login?: RiderLogin;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ password: string; email: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  async function go() {
    if (!supabase) return;
    setBusy(true); setErr(null);
    try {
      const res = await resetRiderPassword(supabase, rider.id, own || undefined);
      setIssued({ password: res.password, email: res.email });
      setOwn('');
      await onDone();
    } catch (e) { setErr(errMessage(e)); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* an operator reading it aloud does not need the clipboard */ }
  }

  if (issued) {
    return (
      <div className="mt-2 rounded-xl bg-brand-green/[0.08] p-3 ring-1 ring-brand-green/30">
        <p className="text-sm font-bold text-green-900">Temporary password for {rider.name}</p>
        {issued.email && (
          <p className="mt-0.5 text-xs text-black/55">They sign in with <b>{issued.email}</b></p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-white px-3 py-2 font-mono text-base font-bold tracking-wide ring-1 ring-black/10">
            {issued.password}
          </code>
          <button onClick={() => void copy()}
            className="shrink-0 rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-xs text-black/55">
          Read this to them now — it isn’t stored anywhere and won’t be shown again. Ask them to
          change it in the rider app once they’re in. If it’s lost, just reset again.
        </p>
        <button onClick={() => { setIssued(null); setOpen(false); }}
          className="mt-2 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white">
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <>
        <button onClick={() => setOpen(true)}
          className="rounded-lg border border-brand-purple/40 px-3 py-1.5 text-xs font-semibold text-brand-purple">
          🔑 Reset password
        </button>
        {login?.last_reset_at && (
          <span className="mt-1 block text-xs text-black/35">
            Last reset {when(login.last_reset_at)}
            {login.last_reset_by ? ` by ${login.last_reset_by}` : ''}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-brand-purple/[0.06] p-3 ring-1 ring-brand-purple/20">
      <p className="text-sm font-bold text-brand-purple">Give {rider.name} a new password</p>
      <p className="mt-0.5 text-xs text-black/55">
        Their old one can’t be shown — it’s stored scrambled, not kept. This replaces it with one
        you can read out to them.
      </p>
      {login?.email && <p className="mt-1 text-xs text-black/55">Signs in with <b>{login.email}</b></p>}
      <input value={own} onChange={(e) => setOwn(e.target.value)}
        placeholder="Leave blank to generate one"
        className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs" />
      {own && own.trim().length < 8 && (
        <p className="mt-1 text-[11px] text-black/45">At least 8 characters if you choose your own.</p>
      )}
      {err && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={() => { setOpen(false); setErr(null); setOwn(''); }} disabled={busy}
          className="flex-1 rounded-lg border border-black/10 bg-white py-2 text-xs font-semibold text-black/60">
          Cancel
        </button>
        <button onClick={() => void go()} disabled={busy || (!!own && own.trim().length < 8)}
          className="flex-1 rounded-lg bg-brand-purple py-2 text-xs font-bold text-white disabled:opacity-50">
          {busy ? 'Setting…' : 'Set a new password'}
        </button>
      </div>
    </div>
  );
}
