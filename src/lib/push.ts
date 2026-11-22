import type { PushSubscriptionInput } from '@common';
import { api } from './api';

const SERVICE_WORKER_PATH = '/sw.js';

/** Browser push needs a secure context, the Push API, and a service worker. */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined';
}

export function getPushPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Registers the service worker only; notification permission is never requested here. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Service worker registration failed', error);
    return null;
  }
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await registerServiceWorker();
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('Invalid push public key.');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/**
 * Must be called directly from a user gesture: the permission prompt is the
 * first await so browsers still consider the request user-initiated.
 */
export async function enablePush(publicKey: string): Promise<PushSubscription> {
  if (!isPushSupported()) throw new Error('Browser push is not supported in this browser.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const registration = await registerServiceWorker();
  if (!registration) throw new Error('Could not register the notification service worker.');

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('The browser returned an incomplete push subscription.');
  }

  const payload: PushSubscriptionInput = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };

  try {
    await api.notifications.subscribePush(payload);
  } catch (error) {
    // Roll back the local subscription so the UI can safely retry.
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }

  return subscription;
}

/** Removes the local subscription and all server-side subscriptions for this user. */
export async function disablePush(): Promise<void> {
  try {
    if (isPushSupported()) {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }
  } finally {
    await api.notifications.unsubscribePush();
  }
}
