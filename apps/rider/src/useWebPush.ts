import { useCallback, useEffect, useState } from 'react';
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array, toStoredSubscription } from '@ebd/shared';
import { saveRiderWebPush, removeRiderWebPush } from '@ebd/supabase';
import { supabase } from './lib/supabase.ts';

export type PushState =
  | 'unsupported'   // no service worker or no push in this browser
  | 'insecure'      // not https, so the browser refuses
  | 'denied'        // the rider said no, and only they can undo it
  | 'off'           // supported, allowed to ask, not subscribed
  | 'on'            // subscribed and stored
  | 'working';

/**
 * Notifications that arrive with the app shut.
 *
 * The in-app alert only exists while the app is open, which is the opposite of
 * when a rider needs to hear that their job was cancelled — phone in a pocket,
 * halfway to a shop. This is web push: the browser holds a subscription, the
 * service worker wakes on a message, and no Firebase project or server key is
 * involved anywhere.
 *
 * Permission is asked for on a tap, never on load. A prompt that appears
 * unbidden gets dismissed, and a dismissal is close to permanent — the browser
 * will not ask twice, and the rider has to dig through site settings to undo
 * it. One wasted prompt costs that rider push forever.
 */
export function useWebPush(riderId: string | undefined) {
  const [state, setState] = useState<PushState>('working');

  const read = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return;
    }
    if (!window.isSecureContext) { setState('insecure'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    } catch { setState('off'); }
  }, []);

  useEffect(() => { void read(); }, [read]);

  /** Register the worker, ask once, subscribe, and store it. */
  const enable = useCallback(async () => {
    if (!supabase || !riderId) return;
    setState('working');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // A worker that is still installing has no pushManager yet.
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const stored = toStoredSubscription(sub);
      if (!stored) { setState('off'); return; }
      await saveRiderWebPush(supabase, riderId, stored);
      setState('on');
    } catch {
      setState('off');
    }
  }, [riderId]);

  /** Stop the pushes, and forget the device server-side so we stop trying. */
  const disable = useCallback(async () => {
    if (!supabase || !riderId) return;
    setState('working');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await removeRiderWebPush(supabase, riderId, sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
    } catch { /* leaving it on is the harmless direction */ }
    await read();
  }, [riderId, read]);

  return { state, enable, disable, refresh: read };
}
