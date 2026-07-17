import { supabase } from '../lib/supabase.ts';
import { createPreviewData } from './preview.ts';
import { createLiveData } from './live.ts';
import type { RiderData } from './types.ts';

// In production the rider id comes from the authenticated, approved rider.
const RIDER_ID = import.meta.env.VITE_RIDER_ID as string | undefined;

export function makeRiderData(): RiderData {
  if (supabase && RIDER_ID) return createLiveData(supabase, RIDER_ID);
  return createPreviewData();
}

export type { RiderData, RiderOrder } from './types.ts';
