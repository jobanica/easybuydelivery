/**
 * Pick-up, delivery, and what carries it.
 *
 * The own shop sells things a motorbike cannot take. So an order from it either
 * gets collected, or the operator puts it on one of their own vehicles, or it
 * goes to the rider network like everything else — decided per order, after
 * seeing what was bought.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Fulfilment = 'pickup' | 'delivery';
export type DeliveryHandler = 'easybuy' | 'in_house';

export interface DeliveryOption {
  id: string;
  name: string;
  fee: number;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Every vehicle the operator has defined, cheapest first. */
export async function listDeliveryOptions(
  db: SupabaseClient, activeOnly = true,
): Promise<DeliveryOption[]> {
  let q = db.from('delivery_options').select('*').order('sort_order').order('fee');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) {
    // The table does not exist until migration 0078 is applied.
    if (error.code === '42P01') return [];
    throw error;
  }
  return (data ?? []) as DeliveryOption[];
}

export async function createDeliveryOption(
  db: SupabaseClient, input: { name: string; fee: number; sortOrder?: number },
): Promise<string> {
  const { data, error } = await db.from('delivery_options')
    .insert({ name: input.name, fee: input.fee, sort_order: input.sortOrder ?? 0 })
    .select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateDeliveryOption(
  db: SupabaseClient, id: string,
  patch: { name?: string; fee?: number; isActive?: boolean; sortOrder?: number },
) {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.fee !== undefined) row.fee = patch.fee;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (Object.keys(row).length === 0) return;
  const { error } = await db.from('delivery_options').update(row).eq('id', id);
  if (error) throw error;
}

/** Blocked once an order has used it, so past orders keep naming what carried them. */
export async function deleteDeliveryOption(db: SupabaseClient, id: string) {
  const { error } = await db.from('delivery_options').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('This vehicle has been used on an order and can’t be deleted. Turn it off instead.');
    }
    throw error;
  }
}

const ASSETS_BUCKET = 'store-assets';

function fileExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'png';
}

/** A photo of the vehicle, so a customer knows what is turning up. */
export async function uploadDeliveryOptionImage(
  db: SupabaseClient, id: string, file: File,
): Promise<string> {
  const path = `delivery-options/${id}/${Date.now()}.${fileExt(file.name)}`;
  const { error: upErr } = await db.storage.from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const url = db.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await db.from('delivery_options').update({ image_url: url }).eq('id', id);
  if (error) throw error;
  return url;
}

/** The supplier's logo on a category, so the shelves read like shelves. */
export async function uploadCategoryImage(
  db: SupabaseClient, categoryId: string, file: File,
): Promise<string> {
  const path = `categories/${categoryId}/${Date.now()}.${fileExt(file.name)}`;
  const { error: upErr } = await db.storage.from(ASSETS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const url = db.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await db.from('menu_categories').update({ image_url: url }).eq('id', categoryId);
  if (error) throw error;
  return url;
}

export interface DeliveryAssignment {
  handler: DeliveryHandler;
  fee: number;
  label: string;
}

/**
 * Put an order on a carrier and price it. Tells the customer in the order chat,
 * because they agreed to this order without knowing the delivery fee.
 */
export async function adminSetDelivery(
  db: SupabaseClient, orderId: string, handler: DeliveryHandler, optionId?: string | null,
): Promise<DeliveryAssignment> {
  const { data, error } = await db.rpc('admin_set_delivery', {
    p_order_id: orderId, p_handler: handler, p_option_id: optionId ?? null,
  });
  if (error) throw error;
  return data as DeliveryAssignment;
}
