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
  order_stores: { store: { name: string | null } | null }[];
}

/** The customer's recent orders (newest first). */
export async function listCustomerOrders(db: SupabaseClient, customerId: string): Promise<CustomerOrder[]> {
  const { data, error } = await db
    .from('orders')
    .select('id, service_type, status, created_at, goods_cost, delivery_fee, store_fee_total, convenience_fee, payment_method, order_stores(store:stores(name))')
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
