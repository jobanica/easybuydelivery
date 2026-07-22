import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { ensureCustomer } from '@ebd/supabase';
import { supabase, isSupabaseConfigured } from '../lib/supabase.ts';

interface AuthValue {
  /** Whether the app is wired to a real backend (vs preview sample mode). */
  live: boolean;
  /** The customer id for this device's orders (set once an order is placed). */
  customerId: string | null;
  /**
   * Ensure a customer record exists for this device and return its id. Signs in
   * anonymously on first use (no account, no OTP) so order RLS is satisfied.
   * Called at checkout with the contact number the customer entered.
   */
  ensureContact: (mobile: string, name?: string) => Promise<string>;
}

const PREVIEW: AuthValue = {
  live: false,
  customerId: 'preview-customer',
  ensureContact: async () => 'preview-customer',
};

const Ctx = createContext<AuthValue>(PREVIEW);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Preview mode: no backend, ordering works with a placeholder id.
  if (!isSupabaseConfigured || !supabase) {
    return <Ctx.Provider value={PREVIEW}>{children}</Ctx.Provider>;
  }
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}

function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const inflight = useRef<Promise<string> | null>(null);

  async function ensureContact(mobile: string, name?: string): Promise<string> {
    // De-dupe concurrent checkouts so we don't create two anonymous users.
    if (inflight.current) return inflight.current;
    const run = (async () => {
      // A session (anonymous) is required to write an order under RLS.
      let { data: { user } } = await supabase!.auth.getUser();
      if (!user) {
        await supabase!.auth.signInAnonymously();
        ({ data: { user } } = await supabase!.auth.getUser());
      }
      const id = await ensureCustomer(supabase!, { mobile: mobile || 'unknown', name });
      setCustomerId(id);
      return id;
    })();
    inflight.current = run;
    try { return await run; }
    finally { inflight.current = null; }
  }

  return (
    <Ctx.Provider value={{ live: true, customerId, ensureContact }}>
      {children}
    </Ctx.Provider>
  );
}
