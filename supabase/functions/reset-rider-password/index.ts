// Supabase Edge Function: give a rider a temporary password.
//
// Riders lose phones and forget passwords, and the reset-email route assumes an
// inbox someone reads — a poor assumption for a job done on a motorbike with a
// prepaid SIM. The operator sets a temporary one instead and reads it out.
//
// It cannot show an existing password, and deliberately has no way to: Supabase
// stores a bcrypt hash, so the original is not there to return. Anything that
// could show it would mean keeping a readable copy of a credential most riders
// reuse for their email and their GCash.
//
//   supabase functions deploy reset-rider-password
//
// Setting a password is the power to become that rider, so the permission is
// checked against the database (the same one that gates the Riders page) rather
// than assumed from having a session, and every reset is recorded before the
// password is handed back.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { preflight, withCors } from '../_shared/cors.ts';

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/**
 * A password someone can read down a phone line without spelling it twice.
 *
 * No i/l/o or 0/1, which are the characters that cause the call-back. Three
 * groups of four from a 31-character alphabet is about 59 bits — far past
 * guessable, and it only has to survive until the rider changes it.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function temporaryPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((g) => g.join('')).join('-');
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('reset-rider-password', e);
    return withCors(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return withCors('POST only', { status: 405 });

  const auth = req.headers.get('Authorization');
  if (!auth) return withCors('not authenticated', { status: 401 });

  const { riderId, password } = await req.json().catch(() => ({}));
  if (!riderId) return withCors('riderId is required', { status: 400 });

  // A chosen password is allowed — some operators have a house convention —
  // but it still has to be one Supabase will accept.
  const chosen = typeof password === 'string' ? password.trim() : '';
  if (chosen && chosen.length < 8) {
    return withCors('A password you choose must be at least 8 characters.', { status: 400 });
  }
  const newPassword = chosen || temporaryPassword();

  // As the caller. log_rider_password_reset refuses anyone who cannot open the
  // Riders section, so the permission is decided by the database and the record
  // is written before the password is handed back — a reset that is not logged
  // does not happen.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { error: logErr } = await asCaller.rpc('log_rider_password_reset', { p_rider_id: riderId });
  if (logErr) {
    return withCors(
      /not allowed/i.test(logErr.message)
        ? 'You do not have permission to reset a rider’s password.'
        : logErr.message,
      { status: 403 },
    );
  }

  const db = admin();
  const { data: rider, error: riderErr } = await db
    .from('riders')
    .select('id, name, profile_id')
    .eq('id', riderId)
    .maybeSingle();
  if (riderErr) return withCors(riderErr.message, { status: 400 });
  if (!rider?.profile_id) {
    return withCors('That rider has no sign-in account yet.', { status: 400 });
  }

  const { data: updated, error: updErr } = await db.auth.admin
    .updateUserById(rider.profile_id as string, { password: newPassword });
  if (updErr) return withCors(updErr.message, { status: 400 });

  return withCors(JSON.stringify({
    riderName: rider.name,
    email: updated.user?.email ?? null,
    // Returned once. It is not stored anywhere readable, here or in the
    // database — if the operator loses it, they reset again.
    password: newPassword,
  }), { headers: { 'Content-Type': 'application/json' } });
}
