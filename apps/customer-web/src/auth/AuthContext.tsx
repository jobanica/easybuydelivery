import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ensureCustomer, onAuthChange, signOut as sbSignOut } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from '../lib/supabase.ts';
import { REQUIRE_ACCOUNT } from '../config.ts';

interface AuthValue {
  /** Whether the app is wired to a real backend (vs preview sample mode). */
  live: boolean;
  /** True once the customer has a verified account and may place orders. */
  authed: boolean;
  /** The signed-in customer's id (used on orders). */
  customerId: string | null;
  /** The account's verified mobile number (E.164 digits). */
  mobile: string;
  /** Ensure/refresh the customer record (name / contact) and return its id. */
  ensureContact: (mobile: string, name?: string) => Promise<string>;
  signOut: () => Promise<void>;
}

const PREVIEW: AuthValue = {
  live: false, authed: true, customerId: 'preview-customer', mobile: '',
  ensureContact: async () => 'preview-customer', signOut: async () => {},
};

const Ctx = createContext<AuthValue>(PREVIEW);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured || !supabase) {
    return <Ctx.Provider value={PREVIEW}>{children}</Ctx.Provider>;
  }
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}

function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const inflight = useRef<Promise<string> | null>(null);

  useEffect(() => onAuthChange(supabase!, (u) => {
    setUserId(u?.id ?? null);
    setMobile(u?.phone ?? '');
  }), []);

  // With the account gate ON, a signed-in phone gets its customer row up front.
  useEffect(() => {
    if (!REQUIRE_ACCOUNT || !userId) { if (!userId) setCustomerId(null); return; }
    ensureCustomer(supabase!, { mobile: mobile || 'unknown' }).then(setCustomerId).catch(() => {});
  }, [userId, mobile]);

  async function ensureContact(m: string, name?: string): Promise<string> {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      // Gate OFF: order under a background anonymous session (no account needed).
      let { data: { user } } = await supabase!.auth.getUser();
      if (!user && !REQUIRE_ACCOUNT) {
        await supabase!.auth.signInAnonymously();
        ({ data: { user } } = await supabase!.auth.getUser());
      }
      const id = await ensureCustomer(supabase!, { mobile: m || mobile || 'unknown', name });
      setCustomerId(id);
      return id;
    })();
    inflight.current = run;
    try { return await run; } finally { inflight.current = null; }
  }

  const value: AuthValue = {
    live: true,
    // When the gate is off, ordering is always allowed.
    authed: REQUIRE_ACCOUNT ? Boolean(userId && customerId) : true,
    customerId,
    mobile,
    ensureContact,
    signOut: async () => { await sbSignOut(supabase!); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
