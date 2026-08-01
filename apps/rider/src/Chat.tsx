import { useEffect, useRef, useState } from 'react';
import { listOrderMessages, sendOrderMessage, subscribeOrderMessages, type OrderMessage } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

/** Order chat overlay. `role` is who the current user is on this order. */
export function Chat({ orderId, role, title, onClose }: {
  orderId: string; role: 'customer' | 'rider'; title: string; onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<OrderMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    listOrderMessages(supabase, orderId).then((m) => { if (alive) setMsgs(m); }).catch(() => {});
    const unsub = subscribeOrderMessages(supabase, orderId, (m) =>
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])));
    return () => { alive = false; unsub(); };
  }, [orderId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  async function send() {
    const t = text.trim();
    if (!t || !supabase) return;
    setText(''); setBusy(true);
    try { await sendOrderMessage(supabase, orderId, role, t); }
    catch { setText(t); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div className="flex h-[75vh] w-full max-w-md flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="text-sm text-brand-purple">Close</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {msgs.length === 0 && <p className="mt-6 text-center text-sm text-black/40">No messages yet. Say hi 👋</p>}
          {msgs.map((m) => {
            const mine = m.sender_role === role;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <span className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-green text-white' : 'bg-black/[0.06] text-black'}`}>
                  {m.body}
                </span>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 border-t border-black/5 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            placeholder="Message…"
            className="min-w-0 flex-1 rounded-full border border-black/10 px-4 py-2 text-sm outline-none focus:border-brand-green" />
          <button onClick={send} disabled={busy || !text.trim()}
            className="shrink-0 rounded-full bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </div>
      </div>
    </div>
  );
}
