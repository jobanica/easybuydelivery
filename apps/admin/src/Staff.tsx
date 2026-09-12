import { useEffect, useState } from 'react';
import {
  listStaff, setUserRole, setStaffPermissions, revokeStaff, createStaff, type StaffMember,
} from '@ebd/supabase';
import {
  STAFF_ROLES, ROLE_LABEL, ALL_SECTIONS, SECTION_LABEL, SECTION_NOTE,
  allowedSections, canManageStaff, type AdminSection, type StaffRole,
  errMessage,
} from '@ebd/shared';
import { supabase } from './lib/supabase.ts';
import { useAdminAccess } from './AdminGate.tsx';
import { Card, Muted, ErrorNote } from './ui.tsx';

const SAMPLE: StaffMember[] = [
  { id: 's1', full_name: 'owner@easybuy.ph', role: 'admin', is_owner: true, permissions: null },
  { id: 's2', full_name: 'manager@easybuy.ph', role: 'manager', is_owner: false, permissions: null },
  { id: 's3', full_name: 'dispatch@easybuy.ph', role: 'dispatcher', is_owner: false, permissions: ['dashboard', 'orders'] },
];

const roleChip: Record<StaffRole, string> = {
  admin: 'bg-brand-purple/15 text-brand-purple',
  manager: 'bg-brand-green/15 text-green-800',
  dispatcher: 'bg-brand-yellow/30 text-yellow-800',
  support: 'bg-black/5 text-black/60',
};

const inp = 'rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand-green';

/**
 * The staff list, and the one place where what each of them can open is decided.
 *
 * Only the owner can change anything here — the database enforces it, so this
 * page shows everyone else the list and nothing else rather than offering
 * buttons that would fail.
 */
export function Staff() {
  const me = useAdminAccess();
  const owner = canManageStaff(me);
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) { setRows(SAMPLE); setLoading(false); return; }
    setLoading(true);
    try { setRows(await listStaff(supabase)); setError(null); }
    catch (e) { setError(errMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function guard(fn: () => Promise<void>) {
    try { await fn(); setError(null); }
    catch (e) { setError(errMessage(e)); }
  }

  async function changeRole(m: StaffMember, next: StaffRole) {
    if (!supabase) { setRows((rs) => rs.map((x) => x.id === m.id ? { ...x, role: next } : x)); return; }
    await guard(async () => { await setUserRole(supabase!, m.id, next); await load(); });
  }

  async function changeAccess(m: StaffMember, next: AdminSection[] | null) {
    if (!supabase) { setRows((rs) => rs.map((x) => x.id === m.id ? { ...x, permissions: next } : x)); return; }
    await guard(async () => { await setStaffPermissions(supabase!, m.id, next); await load(); });
  }

  async function revoke(m: StaffMember) {
    if (!supabase) { setRows((rs) => rs.filter((x) => x.id !== m.id)); return; }
    await guard(async () => { await revokeStaff(supabase!, m.id); await load(); });
  }

  return (
    <div className="max-w-3xl space-y-5">
      {owner
        ? <AddStaff onAdded={load} onError={setError} />
        : (
          <p className="rounded-xl border border-brand-yellow bg-brand-yellow/20 px-3 py-2.5 text-sm">
            Only the owner can add staff or change what anyone can see. You're looking at the list.
          </p>
        )}

      {error && <ErrorNote msg={error} />}
      {loading ? <Muted>Loading…</Muted> : (
        <Card title="Staff">
          <div className="space-y-2">
            {rows.map((m) => (
              <StaffRow key={m.id} member={m} editable={owner && !m.is_owner} isMe={m.id === me.id}
                onRole={(r) => changeRole(m, r)} onAccess={(p) => changeAccess(m, p)}
                onRevoke={() => revoke(m)} />
            ))}
            {rows.length === 0 && <Muted>No staff yet.</Muted>}
          </div>
        </Card>
      )}
    </div>
  );
}

/** One member: what they hold, what they can open, and the way out. */
function StaffRow({ member, editable, isMe, onRole, onAccess, onRevoke }: {
  member: StaffMember;
  editable: boolean;
  isMe: boolean;
  onRole: (r: StaffRole) => Promise<void>;
  onAccess: (p: AdminSection[] | null) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const sections = allowedSections({
    role: member.role, isOwner: member.is_owner, permissions: member.permissions,
  });
  const custom = member.permissions !== null;

  return (
    <div className="rounded-xl ring-1 ring-black/5">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {member.full_name ?? member.id.slice(0, 8)}
          {isMe && <span className="ml-1.5 text-xs font-normal text-black/40">(you)</span>}
        </span>

        {member.is_owner ? (
          <span className="rounded-full bg-brand-green px-2.5 py-1 text-xs font-semibold text-white">Owner</span>
        ) : editable ? (
          <select value={member.role} onChange={(e) => void onRole(e.target.value as StaffRole)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleChip[member.role]}`}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleChip[member.role]}`}>
            {ROLE_LABEL[member.role]}
          </span>
        )}

        <button onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium text-black/60">
          {member.is_owner ? 'Sees everything'
            : `${sections.length} of ${ALL_SECTIONS.length} sections`}
          <span className="ml-1 text-black/30">{open ? '▴' : '▾'}</span>
        </button>

        {editable && (confirming ? (
          <span className="flex items-center gap-1">
            <button onClick={() => void onRevoke()}
              className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white">Remove</button>
            <button onClick={() => setConfirming(false)}
              className="px-1.5 text-xs text-black/45">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600">
            Revoke
          </button>
        ))}
      </div>

      {open && (
        <div className="border-t border-black/5 px-3 py-3">
          {member.is_owner ? (
            <p className="text-sm text-black/50">
              You own this business. Every section is yours, and nobody can take that away or change your account.
            </p>
          ) : (
            <AccessChecklist value={sections} custom={custom} readOnly={!editable}
              onChange={onAccess} roleName={ROLE_LABEL[member.role]} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The sections one person may open.
 *
 * Two states worth keeping apart: following the role's defaults, or a list
 * chosen by hand. Ticking anything moves them to the hand-chosen list, and
 * there is a way back.
 */
function AccessChecklist({ value, custom, readOnly, roleName, onChange }: {
  value: AdminSection[];
  custom: boolean;
  readOnly?: boolean;
  roleName: string;
  onChange: (next: AdminSection[] | null) => Promise<void>;
}) {
  const has = new Set(value);
  const toggle = (s: AdminSection) => {
    const next = new Set(has);
    if (next.has(s)) next.delete(s); else next.add(s);
    return onChange(ALL_SECTIONS.filter((x) => next.has(x)));
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-black/50">
          {custom
            ? 'Chosen by hand. Only the ticked sections appear in their menu.'
            : `Following the ${roleName} defaults. Tick anything to choose by hand instead.`}
        </p>
        {custom && !readOnly && (
          <button onClick={() => void onChange(null)}
            className="text-xs font-medium text-brand-purple">Back to {roleName} defaults</button>
        )}
      </div>

      <div className="grid gap-1 sm:grid-cols-2">
        {ALL_SECTIONS.map((s) => (
          <label key={s} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
            readOnly ? '' : 'cursor-pointer hover:bg-black/[0.03]'}`}>
            <input type="checkbox" checked={has.has(s)} disabled={readOnly}
              onChange={() => void toggle(s)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#1a7f4b]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{SECTION_LABEL[s]}</span>
              <span className="block text-xs leading-snug text-black/45">{SECTION_NOTE[s]}</span>
            </span>
          </label>
        ))}
      </div>
    </>
  );
}

/** Hire someone, and decide what they walk into. */
function AddStaff({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (m: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('dispatcher');
  const [picked, setPicked] = useState<AdminSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setNotice(null); onError(null);
    try {
      if (!supabase) { setNotice('Connect Supabase and deploy create-staff to add accounts.'); return; }
      await createStaff(supabase, { email, password, role, permissions: picked });
      setEmail(''); setPassword(''); setPicked([]);
      setNotice('Staff account created.');
      await onAdded();
    } catch (e2) {
      onError(errMessage(e2));
    } finally { setBusy(false); }
  }

  return (
    <Card title="Add staff account">
      <form onSubmit={add} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[12rem] flex-1"><span className="mb-1 block text-xs font-medium text-black/60">Email</span>
            <input type="email" required className={inp + ' w-full'} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="min-w-[12rem] flex-1"><span className="mb-1 block text-xs font-medium text-black/60">Temp password</span>
            <input type="text" required minLength={6} className={inp + ' w-full'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label><span className="mb-1 block text-xs font-medium text-black/60">Role</span>
            <select className={inp} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></label>
        </div>

        <div className="rounded-xl bg-black/[0.02] p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/45">What they can open</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {ALL_SECTIONS.map((s) => (
              <label key={s} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.03]">
                <input type="checkbox" checked={picked.includes(s)}
                  onChange={() => setPicked((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#1a7f4b]" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{SECTION_LABEL[s]}</span>
                  <span className="block text-xs leading-snug text-black/45">{SECTION_NOTE[s]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-black/40">
            {picked.length === 0
              ? 'Nothing ticked — they’ll sign in to an empty console until you give them something.'
              : `${picked.length} section${picked.length === 1 ? '' : 's'}. You can change this any time.`}
          </p>
        </div>

        <button disabled={busy} className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'Adding…' : 'Add staff'}
        </button>
      </form>
      {notice && <p className="mt-2 text-sm text-green-700">✓ {notice}</p>}
      <p className="mt-2 text-xs text-black/40">
        The role sets what they’re called and is the fallback if you tick nothing. Settings and Staff are worth
        thinking twice about: Settings changes your fees, and Staff shows the list — though only you can change it.
      </p>
    </Card>
  );
}
