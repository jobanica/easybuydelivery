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
  /** The address they sign in with — what an operator actually recognises. */
  email: string | null;
  role: StaffRole;
  /** An operator who owns the business. Owners are peers, not superiors. */
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

/**
 * Everyone who works here, owners first.
 *
 * Goes through `list_staff()` rather than reading `profiles` directly, because
 * the email lives in `auth.users` and nothing signed in as a normal user may
 * read that table. Without it, anyone whose display name was never set showed
 * in the console as eight characters of their uuid — which is not a person.
 *
 * Falls back to the plain profile read when the function isn't there yet, so a
 * console running ahead of migration 0082 still lists staff.
 */
export async function listStaff(db: SupabaseClient): Promise<StaffMember[]> {
  const { data, error } = await db.rpc('list_staff');
  if (!error) {
    return ((data ?? []) as Partial<StaffMember>[]).map(toStaffMember);
  }
  // 42883 = the function does not exist; PGRST202 = it isn't in the schema cache.
  if (error.code !== '42883' && error.code !== 'PGRST202') throw error;

  const fallback = await db
    .from('profiles')
    .select('*')
    .in('role', STAFF_ROLES)
    .order('role');
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as Partial<StaffMember>[])
    .map(toStaffMember)
    .sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
}

function toStaffMember(r: Partial<StaffMember>): StaffMember {
  return {
    id: r.id as string,
    full_name: r.full_name ?? null,
    email: r.email ?? null,
    role: r.role as StaffRole,
    is_owner: r.is_owner === true,
    permissions: r.permissions ?? null,
  };
}

/** What to call this person on screen: their email, then a name, then the id. */
export function staffLabel(m: StaffMember): string {
  return m.email ?? m.full_name ?? m.id.slice(0, 8);
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
