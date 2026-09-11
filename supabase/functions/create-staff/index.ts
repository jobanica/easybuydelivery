// Supabase Edge Function: create a staff account (owner only).
//
// The admin app calls this with the caller's session JWT. Hiring is the owner's
// alone — the same rule the profiles triggers enforce for changing a role or
// handing out permissions — so this checks is_owner, not merely the admin role,
// before using the service role to create the auth user and set up their
// profile. Deploy:  supabase functions deploy create-staff
//
// (Runs on Supabase's edge runtime — not the local dev stack used for this
// repo's verification.)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { preflight, withCors } from '../_shared/cors.ts';

const STAFF_ROLES = ['admin', 'manager', 'dispatcher', 'support'];
const SECTIONS = [
  'dashboard', 'analytics', 'stores', 'ridersActive', 'riders',
  'orders', 'history', 'settlements', 'broadcast', 'areas', 'users', 'settings', 'staff',
];
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function callerIsOwner(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  if (!auth) return false;
  const { data } = await createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  ).auth.getUser();
  if (!data.user) return false;
  const { data: profile } = await admin()
    .from('profiles').select('is_owner').eq('id', data.user.id).single();
  return profile?.is_owner === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return withCors('POST only', { status: 405 });
  if (!(await callerIsOwner(req))) {
    return withCors('Only the owner can add staff.', { status: 403 });
  }

  const { email, password, role, fullName, permissions } = await req.json().catch(() => ({}));
  if (!email || !password || !STAFF_ROLES.includes(role)) {
    return withCors('email, password, and a valid role are required', { status: 400 });
  }
  // What the owner ticked. An empty list is a real answer — hired, shown
  // nothing yet — so it is kept, and only an absent list falls back to the role.
  const sections: string[] | null = Array.isArray(permissions)
    ? permissions.filter((s: unknown) => typeof s === 'string' && SECTIONS.includes(s))
    : null;

  const db = admin();
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) return withCors(error.message, { status: 400 });

  // Trigger creates the profile; set the role, a display name, and exactly what
  // the owner decided this person may open.
  await db.from('profiles').upsert(
    { id: created.user.id, role, full_name: fullName ?? email, permissions: sections },
    { onConflict: 'id' },
  );

  return withCors(JSON.stringify({ id: created.user.id }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
