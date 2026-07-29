/**
 * Rider-side settlement & active-order data access.
 *
 * The daily gate is enforced with the pure helpers in @ebd/shared
 * (owedBalance / overdueBalance / isLockedOut) applied to the rider's ledger
 * rows loaded here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A rider's in-progress orders (accepted but not yet delivered/cancelled),
 * with the linked store(s) embedded so the rider can call the restaurant.
 */
export async function listRiderActiveOrders(db: SupabaseClient, riderId: string) {
  const { data, error } = await db
    .from('orders')
    .select('*, order_stores(store:stores(name, contact_number))')
    .eq('rider_id', riderId)
    .not('status', 'in', '(delivered,cancelled)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The rider's commission ledger entries. */
export async function listRiderLedger(db: SupabaseClient, riderId: string) {
  const { data, error } = await db
    .from('commission_ledger')
    .select('*')
    .eq('rider_id', riderId)
    .order('business_day', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface SettlementRowInput {
  riderId: string;
  businessDay: string; // YYYY-MM-DD
  amountDue: number;
  method?: string;
  reference?: string;
  receiptUrl?: string;
}

export interface SettlementRow {
  rider_id: string;
  business_day: string;
  amount_due: number;
  method: string | null;
  reference: string | null;
  receipt_url: string | null;
  status: 'pending';
}

/** Build a settlement row (pure). Status starts pending until admin confirms. */
export function buildSettlementRow(input: SettlementRowInput): SettlementRow {
  if (input.amountDue < 0) throw new Error('amountDue must be non-negative');
  return {
    rider_id: input.riderId,
    business_day: input.businessDay,
    amount_due: input.amountDue,
    method: input.method ?? null,
    reference: input.reference ?? null,
    receipt_url: input.receiptUrl ?? null,
    status: 'pending',
  };
}

/** Upload a settlement receipt to the public store-assets bucket; returns its URL. */
export async function uploadSettlementReceipt(db: SupabaseClient, file: File): Promise<string> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('not signed in');
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `settlement-receipts/${user.id}/${Date.now()}.${ext}`;
  const { error } = await db.storage.from('store-assets')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return db.storage.from('store-assets').getPublicUrl(path).data.publicUrl;
}

/** Upload the operator's settlement QR image (admin). Returns its public URL. */
export async function uploadSettlementQr(db: SupabaseClient, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `settlement-qr/${Date.now()}.${ext}`;
  const { error } = await db.storage.from('store-assets')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return db.storage.from('store-assets').getPublicUrl(path).data.publicUrl;
}

/**
 * Rider submits a settlement payment for a business day. Admin confirmation
 * (mark-as-paid) flips it to `confirmed` and reactivates the account.
 */
export async function createSettlement(db: SupabaseClient, input: SettlementRowInput) {
  const { data, error } = await db
    .from('settlements')
    .insert(buildSettlementRow(input))
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
