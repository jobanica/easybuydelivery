/**
 * Order chat between the customer and the assigned rider.
 * Messages persist in `order_messages`; new ones arrive live via Realtime.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_profile: string;
  sender_role: 'customer' | 'rider';
  body: string;
  created_at: string;
}

/** Load an order's message history (oldest first). */
export async function listOrderMessages(db: SupabaseClient, orderId: string): Promise<OrderMessage[]> {
  const { data, error } = await db
    .from('order_messages')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrderMessage[];
}

/** Post a message to an order thread as the current user. */
export async function sendOrderMessage(
  db: SupabaseClient,
  orderId: string,
  role: 'customer' | 'rider',
  body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('not signed in');
  const { error } = await db.from('order_messages').insert({
    order_id: orderId,
    sender_profile: user.id,
    sender_role: role,
    body: text,
  });
  if (error) throw error;
}

/** Subscribe to new messages on an order thread. Returns an unsubscribe fn. */
export function subscribeOrderMessages(
  db: SupabaseClient,
  orderId: string,
  onMessage: (m: OrderMessage) => void,
): () => void {
  const channel = db
    .channel(`chat:order:${orderId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
      (payload) => onMessage(payload.new as OrderMessage),
    )
    .subscribe();
  return () => { void db.removeChannel(channel); };
}
