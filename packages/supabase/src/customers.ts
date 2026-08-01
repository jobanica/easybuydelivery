/**
 * Customer self-service: profile, saved delivery addresses, and order history.
 * All reads/writes are scoped to the signed-in customer by RLS
 * (customers_self / customer_addresses_self / orders_customer_read).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyCustomer {
  id: string;
  name: string | null;
  mobile_number: string;
}

/** The customer row for the signed-in user, or null if none yet. */
export async function getMyCustomer(db: SupabaseClient): Promise<MyCustomer | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db
    .from('customers')
    .select('id, name, mobile_number')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as MyCustomer | null) ?? null;
}

export interface CustomerOrder {
  id: string;
  service_type: string;
  status: string;
  created_at: string;
  goods_cost: number;
  delivery_fee: number;
  store_fee_total: number;
  convenience_fee: number;
  payment_method: string | null;
  recipient_name: string | null;
  recipient_contact: string | null;
  order_stores: { store: { name: string | null } | null }[];
}

export interface ActiveDelivery {
  id: string;
  status: string;
  service_type: string;
  payment_method: string | null;
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  storeName: string | null;
  items: { name: string; qty: number; unitPrice: number }[];
}

/**
 * The customer's current in-progress delivery (a rider is assigned and it isn't
 * delivered/cancelled), with pickup (store) and drop-off coordinates for the
 * live tracking map. Null when there's nothing to track.
 */
export async function getActiveDelivery(db: SupabaseClient, customerId: string): Promise<ActiveDelivery | null> {
  const { data, error } = await db
    .from('orders')
    .select('id, status, service_type, payment_method, item_description, delivery_lat, delivery_lng, order_stores(store:stores(name, lat, lng)), order_items(name, qty, unit_price)')
    .eq('customer_id', customerId)
    .not('rider_id', 'is', null)
    .not('status', 'in', '(delivered,cancelled)')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as {
    id: string; status: string; service_type: string; payment_method: string | null; item_description: string | null;
    delivery_lat: number | null; delivery_lng: number | null;
    order_stores?: { store: { name: string | null; lat: number | null; lng: number | null } | null }[];
    order_items?: { name: string; qty: number; unit_price: number }[];
  } | undefined;
  if (!row) return null;
  const store = row.order_stores?.find((os) => os.store?.lat != null && os.store?.lng != null)?.store
    ?? row.order_stores?.[0]?.store ?? null;
  const items = (row.order_items ?? []).map((it) => ({ name: it.name, qty: Number(it.qty ?? 1), unitPrice: Number(it.unit_price ?? 0) }));
  return {
    id: row.id,
    status: row.status,
    service_type: row.service_type,
    payment_method: row.payment_method ?? null,
    pickup: store && store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng } : null,
    dropoff: row.delivery_lat != null && row.delivery_lng != null ? { lat: row.delivery_lat, lng: row.delivery_lng } : null,
    storeName: store?.name ?? null,
    items: items.length ? items : (row.item_description ? [{ name: row.item_description, qty: 1, unitPrice: 0 }] : []),
  };
}

export interface OrderRiderInfo {
  name: string | null;
  mobile_number: string | null;
  photo_url: string | null;
}

/** The assigned rider's name/contact/photo for the caller's own order (tracking card). */
export async function getOrderRiderInfo(db: SupabaseClient, orderId: string): Promise<OrderRiderInfo | null> {
  const { data, error } = await db.rpc('order_rider_info', { p_order_id: orderId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { name: row.name ?? null, mobile_number: row.mobile_number ?? null, photo_url: row.photo_url ?? null } : null;
}

export interface OrderPayToRider {
  rider_name: string | null;
  payout_number: string | null;
  amount: number;
}

/**
 * The assigned rider's GCash/Maya details + amount for one of the caller's own
 * orders, so the sender can pay. Null until a rider accepts. If the rider has no
 * payout number, the caller falls back to the operator's settlement number.
 */
export async function getOrderPayToRider(db: SupabaseClient, orderId: string): Promise<OrderPayToRider | null> {
  const { data, error } = await db.rpc('order_pay_to_rider', { p_order_id: orderId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { rider_name: row.rider_name ?? null, payout_number: row.payout_number ?? null, amount: Number(row.amount ?? 0) } : null;
}

/** Upload the sender's proof of payment for an order and record it on the order. */
export async function uploadPaymentReceipt(db: SupabaseClient, orderId: string, file: File, reference?: string): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `payment-receipts/${orderId}/${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from('store-assets')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw upErr;
  const url = db.storage.from('store-assets').getPublicUrl(path).data.publicUrl;
  const { error } = await db.rpc('set_order_payment_proof', { p_order_id: orderId, p_receipt_url: url, p_reference: reference ?? null });
  if (error) throw error;
  return url;
}

/** Record just a payment reference (no receipt image) on the caller's order. */
export async function setOrderPaymentReference(db: SupabaseClient, orderId: string, reference: string): Promise<void> {
  const { error } = await db.rpc('set_order_payment_proof', { p_order_id: orderId, p_receipt_url: null, p_reference: reference });
  if (error) throw error;
}

/** The customer's recent orders (newest first). */
export async function listCustomerOrders(db: SupabaseClient, customerId: string): Promise<CustomerOrder[]> {
  const { data, error } = await db
    .from('orders')
    .select('id, service_type, status, created_at, goods_cost, delivery_fee, store_fee_total, convenience_fee, payment_method, recipient_name, recipient_contact, order_stores(store:stores(name))')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as CustomerOrder[];
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
}

export async function listAddresses(db: SupabaseClient, customerId: string): Promise<CustomerAddress[]> {
  const { data, error } = await db
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomerAddress[];
}

export async function addAddress(db: SupabaseClient, input: {
  customerId: string; label?: string; address: string; lat?: number | null; lng?: number | null; isDefault?: boolean;
}) {
  if (input.isDefault) {
    await db.from('customer_addresses').update({ is_default: false }).eq('customer_id', input.customerId);
  }
  const { error } = await db.from('customer_addresses').insert({
    customer_id: input.customerId,
    label: input.label?.trim() || null,
    address: input.address.trim(),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    is_default: input.isDefault ?? false,
  });
  if (error) throw error;
}

export async function deleteAddress(db: SupabaseClient, id: string) {
  const { error } = await db.from('customer_addresses').delete().eq('id', id);
  if (error) throw error;
}

export async function setDefaultAddress(db: SupabaseClient, customerId: string, id: string) {
  await db.from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId);
  const { error } = await db.from('customer_addresses').update({ is_default: true }).eq('id', id);
  if (error) throw error;
}
