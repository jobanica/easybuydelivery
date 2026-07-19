// Supabase Edge Function: text each store its items when a food order comes in.
//
// Optional — complements the "rider calls the store" model. Gated by
// app_settings.sms_notify_stores and only fires for food orders where the store
// has a contact number.
//
// Wire as a Database Webhook on `orders` INSERT. Secrets:
//   supabase secrets set SEMAPHORE_API_KEY=...      # https://semaphore.co
//   supabase secrets set SEMAPHORE_SENDER_NAME=EasyBuy   # optional
//   SUPABASE_SERVICE_ROLE_KEY is injected automatically.
//
// Deploy:  supabase functions deploy notify-store
//
// Runs on Supabase's edge runtime (Deno) — not the local dev stack used for this
// repo's verification. Message text comes from @ebd/shared composeStoreOrderSms;
// this file inlines the same format to stay dependency-free in Deno.

import { createClient } from 'jsr:@supabase/supabase-js@2';

function composeStoreOrderSms(storeName: string, items: { name: string; qty: number }[], customerContact?: string, notes?: string) {
  const parts = [`Easy Buy Delivery order for ${storeName}:`, ...items.map((i) => `${i.qty}x ${i.name}`)];
  if (notes?.trim()) parts.push(`Note: ${notes.trim()}`);
  if (customerContact) parts.push(`Customer: ${customerContact}`);
  parts.push('Please prepare for pickup.');
  return parts.join('\n');
}

Deno.serve(async (req) => {
  const payload = await req.json();
  const order = payload.record ?? payload.new;
  if (!order || order.service_type !== 'food') return new Response('skip', { status: 200 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Respect the admin toggle.
  const { data: settings } = await db.from('app_settings').select('sms_notify_stores').single();
  if (!settings?.sms_notify_stores) return new Response('disabled', { status: 200 });

  const apiKey = Deno.env.get('SEMAPHORE_API_KEY');
  if (!apiKey) return new Response('SEMAPHORE_API_KEY not set', { status: 500 });

  // Line items tagged with their store.
  const { data: items } = await db
    .from('order_items')
    .select('store_id, name, qty')
    .eq('order_id', order.id);
  if (!items?.length) return new Response('no items', { status: 200 });

  // Group by store, then fetch each store's name + phone.
  const byStore = new Map<string, { name: string; qty: number }[]>();
  for (const it of items) {
    if (!it.store_id) continue;
    (byStore.get(it.store_id) ?? byStore.set(it.store_id, []).get(it.store_id)!).push({ name: it.name, qty: it.qty });
  }

  const { data: stores } = await db
    .from('stores')
    .select('id, name, contact_number')
    .in('id', [...byStore.keys()]);

  let sent = 0;
  for (const store of stores ?? []) {
    if (!store.contact_number) continue; // no number → rider still calls
    const body = composeStoreOrderSms(
      store.name,
      byStore.get(store.id) ?? [],
      order.customer_contact,
      order.notes,
    );
    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: apiKey,
        number: store.contact_number,
        message: body,
        sendername: Deno.env.get('SEMAPHORE_SENDER_NAME') ?? undefined,
      }),
    });
    if (res.ok) sent++;
  }

  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
