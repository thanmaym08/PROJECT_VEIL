// Project VEIL — Privacy-Masked Service Worker
// Provides zero-knowledge background wake signals without metadata leakage

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let title = 'Project VEIL';
  let body = 'New encrypted transmission';
  let isCall = false;

  try {
    if (event.data) {
      const data = event.data.json();
      if (data.type === 'call') {
        body = 'Incoming encrypted call...';
        isCall = true;
      }
    }
  } catch (e) {
    // Default masked body
  }

  const options = {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: isCall ? 'veil-call' : 'veil-msg',
    renotify: true,
    vibrate: isCall ? [200, 100, 200, 100, 400] : [100, 50, 100],
    data: {
      time: Date.now()
    },
    actions: [
      { action: 'open', title: 'Open App' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
