/**
 * Web push, from the browser's side.
 *
 * The public half of a VAPID key pair is exactly that — public. It is handed to
 * every browser that subscribes, so it belongs in the bundle rather than in an
 * environment variable that has to be threaded through three build pipelines.
 * The private half never leaves the Edge Function's secrets.
 */

/** The operator's VAPID public key, identifying who is allowed to push. */
export const VAPID_PUBLIC_KEY =
  'BKDUjBb9G190mBfepyPncQW46Jbbb-4OWCwe-Vd5ZmOjrNLrtqhZSKKPxWPH0kNLYPvLsGpHxh_Vvk2ybx6erUg';

/**
 * PushManager wants the key as raw bytes, and VAPID keys travel as base64url.
 * Written out rather than pulled in, because one dependency for twelve lines of
 * byte-shuffling is a dependency you maintain forever.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** What a PushSubscription looks like once it is ours to store. */
export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Pull the two keys off a browser subscription in the shape the server needs. */
export function toStoredSubscription(sub: {
  endpoint: string;
  getKey: (name: 'p256dh' | 'auth') => ArrayBuffer | null;
}): WebPushSubscription | null {
  const p256dh = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!p256dh || !auth) return null;
  return { endpoint: sub.endpoint, p256dh: b64url(p256dh), auth: b64url(auth) };
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
