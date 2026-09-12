/**
 * The staff directory: who works here, what they hold, and what they can open.
 *
 * Listing is a plain profile read. Every change — role, permissions, revoking —
 * is the owner's alone, enforced by a trigger on `profiles`, so the calls here
 * will simply fail for anyone else rather than silently doing nothing.
 *
 * Creating a brand-new staff *account* needs the service role, so it goes
 * through the `create-staff` Edge Function (see supabase/functions/create-staff).
 */

import { STAFF_ROLES, type AdminSection, type StaffRole } from '@ebd/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StaffMember {
  id: string;
  full_name: string | null;
  role: StaffRole;
  /** The operator who owns the business. Exactly one, and untouchable. */
  is_owner: boolean;
  /** Sections the owner ticked. null = never ticked, so the role decides. */
  permissions: AdminSection[] | null;
}

/** How the signed-in person stands, which decides what the console shows them. */
export interface MyAccess {
  id: string;
  role: string | null;
  is_owner: boolean;
  permissions: AdminSection[] | null;
}

/**
 * The signed-in user's own standing.
 *
 * `select('*')` rather than naming columns, so a console running against a
 * database without 0079 yet degrades to "no owner, no permissions" instead of
 * erroring on a column that isn't there.
 */
export async function getMyAccess(db: SupabaseClient, userId: string): Promise<MyAccess> {
  const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Partial<StaffMember> & { role?: string };
  return {
    id: userId,
    role: row.role ?? null,
    is_owner: row.is_owner === true,
    permissions: row.permissions ?? null,
  };
}

/** All users holding a staff role, the owner first. */
export async function listStaff(db: SupabaseClient): Promise<StaffMember[]> {
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .in('role', STAFF_ROLES)
    .order('role');
  if (error) throw error;
  const rows = (data ?? []) as Partial<StaffMember>[];
  return rows.map((r) => ({
    id: r.id as string,
    full_name: r.full_name ?? null,
    role: r.role as StaffRole,
    is_owner: r.is_owner === true,
    permissions: r.permissions ?? null,
  })).sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
}

/** Change a user's role. Owner only, enforced by the database. */
export async function setUserRole(db: SupabaseClient, userId: string, role: StaffRole | 'customer') {
  const { error } = await db.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

/**
 * Set exactly which sections one person may open. Owner only.
 *
 * An empty list is a real answer — it means "hired, but shown nothing yet" —
 * so it is stored as an empty array, never as null. Passing null is the way
 * back to letting their role decide.
 */
export async function setStaffPermissions(
  db: SupabaseClient, userId: string, sections: AdminSection[] | null,
) {
  const { error } = await db.from('profiles')
    .update({ permissions: sections })
    .eq('id', userId);
  if (error) throw error;
}

/** Revoke staff access (demote to customer). */
export async function revokeStaff(db: SupabaseClient, userId: string) {
  return setUserRole(db, userId, 'customer');
}

export interface CreateStaffInput {
  email: string;
  password: string;
  role: StaffRole;
  fullName?: string;
  /** What they may open on day one. Empty means nothing until you tick it. */
  permissions?: AdminSection[];
}

/** Create a new staff account via the owner-gated Edge Function. */
export async function createStaff(db: SupabaseClient, input: CreateStaffInput) {
  const { data, error } = await db.functions.invoke('create-staff', { body: input });
  if (error) throw error;
  return data as { id: string };
}
