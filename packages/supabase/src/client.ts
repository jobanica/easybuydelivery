import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client from explicit url/key (framework-agnostic so it works
 * in Vite apps, RN, and Node). Apps typically read these from their own env.
 */
export function createEbdClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('Supabase url and anon key are required');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export type { SupabaseClient };
