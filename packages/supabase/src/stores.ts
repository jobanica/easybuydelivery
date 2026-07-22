/**
 * Stores & menus data access.
 *
 * Admin owns all store/menu data (no merchant login). Customers read only
 * available stores; the per-store `is_available` flag is the merchant on/off
 * toggle, independent of the system-wide operating-hours switch.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoreInput {
  name: string;
  category?: string;
  address?: string;
  lat?: number;
  lng?: number;
  contactNumber?: string;
}

export interface MenuItemInput {
  storeId: string;
  categoryId?: string;
  name: string;
  description?: string;
  price: number;
}

/** Customer-facing: only stores currently available. */
export async function listAvailableStores(db: SupabaseClient) {
  const { data, error } = await db
    .from('stores')
    .select('*')
    .eq('is_available', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Admin-facing: all stores including unavailable ones. */
export async function listAllStores(db: SupabaseClient) {
  const { data, error } = await db.from('stores').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createStore(db: SupabaseClient, input: StoreInput) {
  const { data, error } = await db
    .from('stores')
    .insert({
      name: input.name,
      category: input.category ?? null,
      address: input.address ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      contact_number: input.contactNumber ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** The per-merchant on/off toggle. */
export async function setStoreAvailability(db: SupabaseClient, storeId: string, available: boolean) {
  const { error } = await db.from('stores').update({ is_available: available }).eq('id', storeId);
  if (error) throw error;
}

export interface StorePatch {
  name?: string;
  category?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  contactNumber?: string | null;
}

/** Update editable fields of an existing store (e.g. pinning its map location). */
export async function updateStore(db: SupabaseClient, storeId: string, patch: StorePatch) {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.address !== undefined) row.address = patch.address;
  if (patch.lat !== undefined) row.lat = patch.lat;
  if (patch.lng !== undefined) row.lng = patch.lng;
  if (patch.contactNumber !== undefined) row.contact_number = patch.contactNumber;
  if (Object.keys(row).length === 0) return;
  const { error } = await db.from('stores').update(row).eq('id', storeId);
  if (error) throw error;
}

/** Set (or clear) a store's map pin. */
export async function setStoreLocation(
  db: SupabaseClient, storeId: string, loc: { lat: number; lng: number } | null,
) {
  const { error } = await db
    .from('stores')
    .update({ lat: loc?.lat ?? null, lng: loc?.lng ?? null })
    .eq('id', storeId);
  if (error) throw error;
}

/** A store's menu: categories with their items (available items only for customers). */
export async function listMenu(db: SupabaseClient, storeId: string, availableOnly = true) {
  const cats = await db
    .from('menu_categories')
    .select('*')
    .eq('store_id', storeId)
    .order('sort_order');
  if (cats.error) throw cats.error;

  let itemsQuery = db.from('menu_items').select('*').eq('store_id', storeId).order('name');
  if (availableOnly) itemsQuery = itemsQuery.eq('is_available', true);
  const items = await itemsQuery;
  if (items.error) throw items.error;

  return { categories: cats.data ?? [], items: items.data ?? [] };
}

export async function createMenuItem(db: SupabaseClient, input: MenuItemInput) {
  if (input.price < 0) throw new Error('price must be non-negative');
  const { data, error } = await db
    .from('menu_items')
    .insert({
      store_id: input.storeId,
      category_id: input.categoryId ?? null,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function setMenuItemAvailability(db: SupabaseClient, itemId: string, available: boolean) {
  const { error } = await db.from('menu_items').update({ is_available: available }).eq('id', itemId);
  if (error) throw error;
}
