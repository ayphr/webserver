/* Ayphr notification service worker. No notification permission is requested here. */
const DEFAULT_URL = '/dashboard/notifications';
const DEFAULT_ICON = '/android-chrome-192x192.png';
const DEFAULT_BADGE = '/favicon-32x32.png';

function internalPath(value, fallback) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password) return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : 'Ayphr notification';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: internalPath(payload.icon, DEFAULT_ICON),
    badge: internalPath(payload.badge, DEFAULT_BADGE),
    tag: typeof payload.tag === 'string' && payload.tag ? payload.tag : 'ayphr-notification',
    data: { url: internalPath(payload.url, DEFAULT_URL) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(internalPath(event.notification.data?.url, DEFAULT_URL), self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = windows.filter((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    const exact = sameOrigin.find((client) => client.url === target);
    const candidate = exact ?? sameOrigin[0];
    if (candidate) {
      try {
        await candidate.focus();
        if ('navigate' in candidate && candidate.url !== target) {
          await candidate.navigate(target);
        }
        return;
      } catch {
        // Fall back to a fresh window if the existing client cannot navigate.
      }
    }

    await self.clients.openWindow(target);
  })());
});
