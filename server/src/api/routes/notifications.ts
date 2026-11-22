import type { NotificationFilter, PushSubscriptionInput } from '@common';
import { json, parsePositiveInt, readValidatedJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  getNotificationPreferences,
  getPushPublicKey,
  notifyUser,
  parseNotificationPreferencesUpdate,
  updateNotificationPreferences,
} from '../../lib/notifications';
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  deleteAllPushSubscriptions,
  listPushSubscriptions,
  savePushSubscription,
} from '../../lib/db/pushSubscriptions';
import {
  countNotificationsForUserUuid,
  getUnreadNotificationCount,
  listNotificationsForUserUuid,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/db';

const guardOptions = { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true };

const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
const MAX_NOTIFICATION_PAGE_SIZE = 100;
const MAX_SUBSCRIPTION_BODY_BYTES = 2048;

/** Only real browser push services are accepted as notification endpoints. */
const PUSH_HOST_PATTERNS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/i,
  /^[a-z0-9-]+\.push\.googleapis\.com$/i,
  /^updates\.push\.services\.mozilla\.com$/i,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/i,
  /^[a-z0-9-]+\.push\.apple\.com$/i,
  /^wns2-[a-z0-9-]+\.notify\.windows\.com$/i,
  /^[a-z0-9-]+\.push\.microsoft\.com$/i,
];
const P256DH_PATTERN = /^[A-Za-z0-9_-]{80,120}$/;
const AUTH_PATTERN = /^[A-Za-z0-9_-]{20,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unknown field "${key}"`);
  }
}

/** Validates a browser PushSubscription before it reaches the database. */
export function parsePushSubscription(value: unknown): PushSubscriptionInput {
  if (!isRecord(value)) throw new Error('subscription must be an object');
  assertOnlyKeys(value, ['endpoint', 'keys'], 'subscription');

  const endpoint = value.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 2048) {
    throw new Error('invalid push endpoint');
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('invalid push endpoint');
  }
  if (url.protocol !== 'https:') throw new Error('push endpoint must use HTTPS');
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('invalid push endpoint');
  }
  if (!PUSH_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error('push endpoint host is not supported');
  }

  const keys = value.keys;
  if (!isRecord(keys)) throw new Error('subscription keys must be an object');
  assertOnlyKeys(keys, ['p256dh', 'auth'], 'subscription keys');

  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (typeof p256dh !== 'string' || !P256DH_PATTERN.test(p256dh)) {
    throw new Error('invalid p256dh key');
  }
  if (typeof auth !== 'string' || !AUTH_PATTERN.test(auth)) {
    throw new Error('invalid auth key');
  }

  return { endpoint, keys: { p256dh, auth } };
}

const handleList = requireAuth(async (request, user) => {
  const params = new URL(request.url).searchParams;
  const rawFilter = params.get('filter');
  const filter: NotificationFilter = rawFilter === 'all' ? 'all' : 'unread';
  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = Math.min(
    parsePositiveInt(params.get('pageSize'), DEFAULT_NOTIFICATION_PAGE_SIZE),
    MAX_NOTIFICATION_PAGE_SIZE,
  );
  const skip = (page - 1) * pageSize;

  const [notifications, total, unreadCount] = await Promise.all([
    listNotificationsForUserUuid(user.uuid, filter, { skip, limit: pageSize }),
    countNotificationsForUserUuid(user.uuid, filter),
    getUnreadNotificationCount(user.uuid),
  ]);

  return json({
    notifications,
    total,
    unreadCount,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}, guardOptions);

const handleUnreadCount = requireAuth(async (_request, user) => {
  const unreadCount = await getUnreadNotificationCount(user.uuid);
  return json({ unreadCount });
}, guardOptions);

const handleMarkRead = requireAuth(async (_request, user, params) => {
  const id = params.id;
  if (!id) return json({ error: 'notification id is required' }, 400);

  const updated = await markNotificationRead(user.uuid, id);
  if (!updated) return json({ error: 'notification not found' }, 404);

  const unreadCount = await getUnreadNotificationCount(user.uuid);
  return json({ read: true, unreadCount });
}, guardOptions);

const handleMarkAllRead = requireAuth(async (_request, user) => {
  const updated = await markAllNotificationsRead(user.uuid);
  return json({ read: true, updated, unreadCount: 0 });
}, guardOptions);

const handleGetNotificationPreferences = requireAuth(async (_request, user) => {
  return json(await getNotificationPreferences(user.uuid));
}, guardOptions);

const handleUpdateNotificationPreferences = requireAuth(async (request, user) => {
  const parsed = await readValidatedJsonBody(request, parseNotificationPreferencesUpdate);
  if ('error' in parsed) return parsed.error;

  return json(await updateNotificationPreferences(user.uuid, parsed.value));
}, guardOptions);

const handleGetPushPublicKey = requireAuth(async () => {
  // The private VAPID key never leaves the server.
  return json({ publicKey: getPushPublicKey() });
}, guardOptions);

const handleSubscribePush = requireAuth(async (request, user) => {
  if (!getPushPublicKey()) return json({ error: 'web push is not configured' }, 503);

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'request body must be valid JSON' }, 400);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_SUBSCRIPTION_BODY_BYTES) {
    return json({ error: 'subscription body is too large' }, 413);
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return json({ error: 'request body must be valid JSON' }, 400);
  }

  let subscription: PushSubscriptionInput;
  try {
    subscription = parsePushSubscription(value);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid subscription' }, 400);
  }

  const subscriptions = await listPushSubscriptions(user.uuid);
  const alreadyStored = subscriptions.some((item) => item.endpoint === subscription.endpoint);
  if (!alreadyStored && subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
    return json({ error: 'too many push subscriptions; unsubscribe another device first' }, 429);
  }

  await savePushSubscription(user.uuid, subscription);
  return json({ subscribed: true });
}, guardOptions);

const handleUnsubscribePush = requireAuth(async (_request, user) => {
  const removed = await deleteAllPushSubscriptions(user.uuid);
  return json({ unsubscribed: true, removed });
}, guardOptions);

/** Sends one notification through the same fan-out path as real events. */
const handleSendTestPush = requireAuth(async (_request, user) => {
  if (!getPushPublicKey()) return json({ error: 'web push is not configured' }, 503);

  await notifyUser({
    userUuid: user.uuid,
    type: 'system',
    title: 'Ayphr test notification',
    message: 'Browser push notifications are working on this device.',
    link: '/dashboard/notifications',
  });
  return json({ sent: true });
}, guardOptions);

export {
  handleList,
  handleUnreadCount,
  handleMarkRead,
  handleMarkAllRead,
  handleGetNotificationPreferences,
  handleUpdateNotificationPreferences,
  handleGetPushPublicKey,
  handleSubscribePush,
  handleUnsubscribePush,
  handleSendTestPush,
};
