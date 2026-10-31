// Supabase Edge Function: push a rider about one order.
//
// Replaces notify-riders, which could never have worked: it posted to
// fcm.googleapis.com/fcm/send — the legacy FCM endpoint Google decommissioned
// in June 2024 — and nothing in the repository ever invoked it.
//
// Web push instead. No Firebase project, no server key: a VAPID key pair is the
// whole credential, and the public half already ships in the rider bundle.
//
//   supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_SUBJECT=mailto:...
//   supabase functions deploy push-riders
//
// Called by whoever caused the event, carrying their own session. Who may be
// told about an order is decided in the database by push_audience(), so running
// as the caller costs nothing in safety — a session with no business knowing
// about an order gets an empty list or an exception, not a send.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { preflight, withCors } from '../_shared/cors.ts';

interface Audience {
  rider_id: string;
  platform: string;
  token: string;
  p256dh: string | null;
  auth: string | null;
}

/** What each kind of event says on a lock screen. */
function compose(kind: string, order: Record<string, unknown>) {
  const service = String(order.service_type ?? 'order');
  const peso = (v: unknown) => `₱${Number(v ?? 0).toFixed(2)}`;
  if (kind === 'cancelled') {
    const goods = Number(order.goods_cost ?? 0);
    return {
      title: '⛔ Your order was cancelled',
      // The money is the point. A rider who has not yet paid needs to not pay;
      // one who has needs to say so now rather than at the door.
      body: goods > 0
        ? `The ${service} order was called off. Goods ${peso(goods)} — stop before paying.`
        : `The ${service} order was called off. Open the app for the reason.`,
      tag: `cancel-${order.id}`,
      urgent: true,
      url: '/',
    };
  }
  return {
    title: 'New order in the pool',
    body: `${service} · ${peso(order.delivery_fee)} delivery · earn ${peso(order.commission_amount)}`,
    tag: `new-${order.id}`,
    urgent: false,
    url: '/',
  };
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    // A push that fails must say why. Silently 500-ing here looks identical to
    // a notification that was simply never sent, which is the exact failure
    // this whole function exists to end.
    console.error('push-riders', e);
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

  const { orderId, kind } = await req.json().catch(() => ({}));
  if (!orderId || (kind !== 'cancelled' && kind !== 'new_order')) {
    return withCors('orderId and a valid kind are required', { status: 400 });
  }

  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  if (!privateKey || !publicKey) {
    return withCors('VAPID keys are not configured', { status: 500 });
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@easybuydelivery.ph',
    publicKey,
    privateKey,
  );

  // As the caller: push_audience() decides whether they may tell anyone.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );

  const { data: audience, error: audErr } = await db
    .rpc('push_audience', { p_order_id: orderId, p_kind: kind });
  if (audErr) return withCors(audErr.message, { status: 403 });

  const devices = (audience ?? []) as Audience[];
  if (devices.length === 0) {
    return withCors(JSON.stringify({ sent: 0, failed: 0, reason: 'nobody to tell' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: order } = await db
    .from('orders')
    .select('id, service_type, goods_cost, delivery_fee, commission_amount')
    .eq('id', orderId)
    .maybeSingle();
  const payload = JSON.stringify(compose(kind, (order ?? { id: orderId }) as Record<string, unknown>));

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];

  await Promise.all(devices.map(async (d) => {
    // Native tokens live in the same table; this function speaks web push only.
    if (d.platform !== 'web' || !d.p256dh || !d.auth) { failed++; return; }
    try {
      await webpush.sendNotification(
        { endpoint: d.token, keys: { p256dh: d.p256dh, auth: d.auth } },
        payload,
        { TTL: kind === 'cancelled' ? 3600 : 600, urgency: 'high' },
      );
      sent++;
    } catch (e) {
      failed++;
      // 404/410 is the push service saying this subscription is dead — a
      // cleared browser, a reinstall, notifications revoked. Keeping it means
      // retrying forever against something that can never answer.
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(d.token);
    }
  }));

  for (const token of gone) {
    // PostgrestBuilder is thenable but not a Promise, so it has no .catch —
    // await it and read the error off the result instead.
    const { error } = await db.rpc('forget_push_endpoint', { p_token: token });
    if (error) console.warn('could not prune endpoint', error.message);
  }

  return withCors(JSON.stringify({ sent, failed, pruned: gone.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
