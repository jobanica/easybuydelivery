import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthChange, ensureCustomer, signOut as sbSignOut } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from '../lib/supabase.ts';

interface AuthValue {
  /** Whether the app is wired to a real backend (vs preview sample mode). */
  live: boolean;
  /** True when the user may place orders (always true in preview). */
  authed: boolean;
  /** The authenticated customer id used for orders. */
  customerId: string | null;
  mobile: string;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue>({
  live: false, authed: true, customerId: 'preview-customer', mobile: '', signOut: async () => {},
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Preview mode: no backend, ordering works with a placeholder id.
  if (!isSupabaseConfigured || !supabase) {
    return (
      <Ctx.Provider value={{ live: false, authed: true, customerId: 'preview-customer', mobile: '', signOut: async () => {} }}>
        {children}
      </Ctx.Provider>
    );
  }
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}

function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');

  useEffect(() => onAuthChange(supabase!, (user) => setUserId(user?.id ?? null)), []);

  // On sign-in, ensure the customer row exists (idempotent) and cache its id.
  useEffect(() => {
    if (!userId) { setCustomerId(null); return; }
    // Mobile may already be known from the OTP contact; fall back to a lookup.
    (async () => {
      const m = mobile || (await supabase!.from('customers').select('mobile_number').eq('profile_id', userId).maybeSingle()).data?.mobile_number || '';
      const id = await ensureCustomer(supabase!, { mobile: m || 'unknown' });
      setCustomerId(id);
      if (m) setMobile(m);
    })().catch(() => {});
  }, [userId]);

  const value: AuthValue = {
    live: true,
    authed: Boolean(userId && customerId),
    customerId,
    mobile,
    signOut: async () => { await sbSignOut(supabase!); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
