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

/** Read a rider's current online/offline availability. */
export async function getRiderOnline(db: SupabaseClient, riderId: string): Promise<boolean> {
  const { data, error } = await db
    .from('riders')
    .select('is_online')
    .eq('id', riderId)
    .maybeSingle();
  if (error) throw error;
  return Boolean((data as { is_online?: boolean } | null)?.is_online);
}

/**
 * A rider marks themselves online/offline. Goes through the set_rider_online
 * RPC (SECURITY DEFINER) so only the is_online flag on the caller's own row is
 * touched — riders can't update their row directly. Returns the new state.
 */
export async function setRiderOnline(db: SupabaseClient, online: boolean): Promise<boolean> {
  const { data, error } = await db.rpc('set_rider_online', { p_online: online });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Resume an existing rider account by mobile number (stop-gap login). Re-links
 * the matched rider to the current session via the resume_rider RPC and returns
 * it, or null if no rider matches. Phone-number match only — no OTP yet.
 */
export async function resumeRiderByMobile(
  db: SupabaseClient,
  mobile: string,
): Promise<{ id: string; application_status: string; name: string | null } | null> {
  const { data, error } = await db.rpc('resume_rider', { p_mobile: mobile });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const r = row as { id: string; application_status: string; name: string | null };
  return { id: r.id, application_status: r.application_status, name: r.name ?? null };
}

export interface RiderProfile {
  id: string;
  name: string;
  mobile_number: string;
  vehicle: string | null;
  photo_url: string | null;
  payout_number: string | null;
  services_accepted: string[] | null;
  push_enabled: boolean;
  application_status: string;
}

/** Read the signed-in rider's full profile (own row, via riders_self_read). */
export async function getRiderProfile(db: SupabaseClient, riderId: string): Promise<RiderProfile | null> {
  const { data, error } = await db
    .from('riders')
    .select('id, name, mobile_number, vehicle, photo_url, payout_number, services_accepted, push_enabled, application_status')
    .eq('id', riderId)
    .maybeSingle();
  if (error) throw error;
  return (data as RiderProfile | null) ?? null;
}

export interface RiderProfilePatch {
  name: string;
  mobile: string;
  vehicle?: string | null;
  photoUrl?: string | null;
  payoutNumber?: string | null;
  services?: string[] | null; // null = accept all services
  pushEnabled?: boolean;
}

/** Update the caller's own rider profile via the update_rider_profile RPC. */
export async function updateRiderProfile(db: SupabaseClient, patch: RiderProfilePatch): Promise<void> {
  const { error } = await db.rpc('update_rider_profile', {
    p_name: patch.name,
    p_mobile: patch.mobile,
    p_vehicle: patch.vehicle ?? null,
    p_photo_url: patch.photoUrl ?? null,
    p_payout_number: patch.payoutNumber ?? null,
    p_services: patch.services ?? null,
    p_push_enabled: patch.pushEnabled ?? null,
  });
  if (error) throw error;
}

/** Upload a rider's avatar to the public store-assets bucket; returns its URL. */
export async function uploadRiderPhoto(db: SupabaseClient, file: File): Promise<string> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('not signed in');
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `rider-avatars/${user.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from('store-assets')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (upErr) throw upErr;
  return db.storage.from('store-assets').getPublicUrl(path).data.publicUrl;
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
