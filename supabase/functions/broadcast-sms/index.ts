// Supabase Edge Function: bulk SMS broadcast to an audience.
//
// True bulk send (announcements / promos). Protected by a shared secret so it
// can't be called anonymously. Uses the same provider adapter as notify-store.
//
//   supabase secrets set BROADCAST_SECRET=<random>
//   supabase secrets set SMS_PROVIDER=bulksms_ph BULKSMS_PH_USERNAME=... BULKSMS_PH_PASSWORD=...
//   supabase functions deploy broadcast-sms
//
// Call:
//   POST /functions/v1/broadcast-sms
//   Header: x-broadcast-secret: <secret>
//   Body:   { "message": "...", "audience": "customers" | "riders" | "stores",
//             "numbers": ["09..."] }   // audience OR explicit numbers
//
// Respect consent/opt-out before broadcasting to customers.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendSms } from '../_shared/sms.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (req.headers.get('x-broadcast-secret') !== Deno.env.get('BROADCAST_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const { message, audience, numbers } = await req.json().catch(() => ({}));
  if (!message || typeof message !== 'string') {
    return new Response('message required', { status: 400 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let recipients: string[] = Array.isArray(numbers) ? numbers : [];
  if (audience === 'customers') {
    const { data } = await db.from('customers').select('mobile_number');
    recipients = (data ?? []).map((r) => r.mobile_number).filter(Boolean);
  } else if (audience === 'riders') {
    const { data } = await db.from('riders').select('mobile_number').eq('application_status', 'approved');
    recipients = (data ?? []).map((r) => r.mobile_number).filter(Boolean);
  } else if (audience === 'stores') {
    const { data } = await db.from('stores').select('contact_number').not('contact_number', 'is', null);
    recipients = (data ?? []).map((r) => r.contact_number).filter(Boolean);
  }

  if (recipients.length === 0) return new Response('no recipients', { status: 200 });

  const result = await sendSms(recipients, message);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
