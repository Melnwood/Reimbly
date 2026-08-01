/* Reimbly service worker — just enough to receive push notifications.
   iOS only delivers web push when the app has been "Added to Home Screen". */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Reimbly';
  const options = {
    body: data.body || '',
    icon: '/logo-mark.png',
    badge: '/logo-mark.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an open Reimbly tab, or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.focus(); if ('navigate' in client) client.navigate(url); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
