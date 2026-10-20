/*
 * The rider's service worker.
 *
 * This is the only part of the app that runs when the app is shut, which makes
 * it the only part that can tell a rider their job was cancelled while the
 * phone was in their pocket. It is deliberately tiny and has no build step:
 * a service worker that fails to parse silently stops delivering push, and the
 * failure looks exactly like no notification having been sent.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // A push with no readable payload still means something happened, and saying
  // so beats staying silent — but we can only be vague about what.
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'Easy Buy Rider';
  const options = {
    body: data.body || 'Open the app for details.',
    tag: data.tag || 'ebd',
    // A cancellation must not be swallowed by an identically-tagged earlier
    // notification; renotify re-alerts on the same tag.
    renotify: true,
    requireInteraction: data.urgent === true,
    vibrate: data.urgent ? [400, 120, 400] : [180, 90, 180],
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse a tab that is already open rather than stacking another one on a
    // phone that has limited patience for them.
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
