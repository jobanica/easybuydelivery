/**
 * Rider application + approval data access (admin side).
 */

import type { RiderApplicationStatus } from '@ebd/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RiderApplicationInput {
  profileId: string;
  name: string;
  mobileNumber: string;
  idDocument?: string;
  vehicle?: string;
}

/** A rider applies through the app; starts in `pending`. */
export async function applyAsRider(db: SupabaseClient, input: RiderApplicationInput) {
  const { data, error } = await db
    .from('riders')
    .insert({
      profile_id: input.profileId,
      name: input.name,
      mobile_number: input.mobileNumber,
      id_document: input.idDocument ?? null,
      vehicle: input.vehicle ?? null,
      application_status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** List rider applications, optionally filtered by status (admin). */
export async function listRiders(db: SupabaseClient, status?: RiderApplicationStatus) {
  let q = db.from('riders').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('application_status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Admin approves or rejects an application. */
export async function setRiderApplicationStatus(
  db: SupabaseClient,
  riderId: string,
  status: RiderApplicationStatus,
) {
  const { error } = await db
    .from('riders')
    .update({ application_status: status })
    .eq('id', riderId);
  if (error) throw error;
}
