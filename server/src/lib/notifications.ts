import { sendNotification, setVapidDetails } from 'web-push';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  type NotificationPreferences,
  type NotificationPreferencesUpdate,
  type NotificationType,
  type User,
} from '@common';
import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../env';
import { type CreateNotificationInput, createNotification } from './db/notifications';
import {
  NOTIFICATION_PREFERENCES_COLLECTION,
  getCollection,
  trackMongoOperation,
} from './db/internal';
import {
  deletePushSubscription,
  listPushSubscriptions,
  recordPushSubscriptionFailure,
} from './db/pushSubscriptions';
import { buildNotificationEmail, sendEmail } from './email';
import { parseUserAgent, resolveLocationFromClient } from './session';
import { createLogger } from './logger';

const log = createLogger('notifications');

const NOTIFICATION_CHANNELS = ['inApp', 'email', 'push'] as const;
type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set<string>(NOTIFICATION_TYPES);
const DEFAULT_PUSH_URL = '/dashboard/notifications';
const PUSH_ICON = '/android-chrome-192x192.png';
const PUSH_BADGE = '/favicon-32x32.png';

let vapidConfigured = false;

type LoginMeta = {
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unknown field "${key}"`);
  }
}

/**
 * Reads a stored preferences document defensively. Anything unexpected falls
 * back to defaults so an old or corrupted document never disables delivery.
 */
export function coerceNotificationPreferences(value: unknown): NotificationPreferences | null {
  if (!isRecord(value)) return null;
  for (const channel of NOTIFICATION_CHANNELS) {
    if (typeof value[channel] !== 'boolean') return null;
  }

  const types: Partial<Record<NotificationType, boolean>> = {};
  if (value.types !== undefined) {
    if (!isRecord(value.types)) return null;
    for (const [type, enabled] of Object.entries(value.types)) {
      if (!NOTIFICATION_TYPE_SET.has(type) || typeof enabled !== 'boolean') return null;
      types[type as NotificationType] = enabled;
    }
  }

  return {
    inApp: value.inApp as boolean,
    email: value.email as boolean,
    push: value.push as boolean,
    types,
  };
}

/** Strict validation for PATCH bodies; throws a descriptive error when invalid. */
export function parseNotificationPreferencesUpdate(value: unknown): NotificationPreferencesUpdate {
  if (!isRecord(value)) throw new Error('preferences must be an object');
  assertOnlyKeys(value, [...NOTIFICATION_CHANNELS, 'types'], 'preferences');

  const update: NotificationPreferencesUpdate = {};
  for (const channel of NOTIFICATION_CHANNELS) {
    if (!(channel in value)) continue;
    const enabled = value[channel];
    if (typeof enabled !== 'boolean') throw new Error(`${channel} must be a boolean`);
    update[channel] = enabled;
  }

  if ('types' in value) {
    const rawTypes = value.types;
    if (!isRecord(rawTypes)) throw new Error('types must be an object');
    const types: Partial<Record<NotificationType, boolean>> = {};
    for (const [type, enabled] of Object.entries(rawTypes)) {
      if (!NOTIFICATION_TYPE_SET.has(type)) throw new Error(`unknown notification type "${type}"`);
      if (typeof enabled !== 'boolean') throw new Error(`types.${type} must be a boolean`);
      types[type as NotificationType] = enabled;
    }
    update.types = types;
  }

  return update;
}

export function mergeNotificationPreferences(
  current: NotificationPreferences,
  update: NotificationPreferencesUpdate,
): NotificationPreferences {
  return {
    inApp: update.inApp ?? current.inApp,
    email: update.email ?? current.email,
    push: update.push ?? current.push,
    types: update.types ? { ...current.types, ...update.types } : { ...current.types },
  };
}

/** A channel must be on, and a per-type override may additionally mute a type. */
export function isNotificationEnabled(
  preferences: NotificationPreferences,
  channel: NotificationChannel,
  type: NotificationType,
): boolean {
  return preferences[channel] && (preferences.types[type] ?? true);
}

async function defaultPreferences(): Promise<NotificationPreferences> {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, types: {} };
}

/** Missing preferences, or a temporary read failure, preserve existing behavior. */
async function loadNotificationPreferences(userUuid: string): Promise<NotificationPreferences> {
  try {
    return await getNotificationPreferences(userUuid);
  } catch (error) {
    log.warn({ error, userUuid }, 'failed to load notification preferences; using defaults');
    return defaultPreferences();
  }
}

export async function getNotificationPreferences(userUuid: string): Promise<NotificationPreferences> {
  const collection = await getCollection('notificationPreferences');
  trackMongoOperation('findOne', NOTIFICATION_PREFERENCES_COLLECTION);
  const doc = await collection.findOne({ userUuid });
  return coerceNotificationPreferences(doc) ?? defaultPreferences();
}

export async function updateNotificationPreferences(
  userUuid: string,
  update: NotificationPreferencesUpdate,
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userUuid);
  const next = mergeNotificationPreferences(current, update);
  const collection = await getCollection('notificationPreferences');
  trackMongoOperation('updateOne', NOTIFICATION_PREFERENCES_COLLECTION);
  await collection.updateOne(
    { userUuid },
    {
      $set: {
        userUuid,
        inApp: next.inApp,
        email: next.email,
        push: next.push,
        types: next.types,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  return next;
}

export async function deleteNotificationPreferencesForUserUuid(userUuid: string): Promise<void> {
  const collection = await getCollection('notificationPreferences');
  trackMongoOperation('deleteMany', NOTIFICATION_PREFERENCES_COLLECTION);
  await collection.deleteMany({ userUuid });
}

/** Push notification endpoints are browser-generated HTTPS URLs. */
export function toInternalPushUrl(link?: string): string {
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.includes('\\')) {
    return DEFAULT_PUSH_URL;
  }
  try {
    const base = 'https://ayphr.internal';
    const url = new URL(link, base);
    if (url.origin !== base || url.username || url.password) return DEFAULT_PUSH_URL;
    return `${url.pathname}${url.search}${url.hash}` || DEFAULT_PUSH_URL;
  } catch {
    return DEFAULT_PUSH_URL;
  }
}

export function getPushPublicKey(): string | null {
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT ? VAPID_PUBLIC_KEY : null;
}

function ensureVapidConfigured(): boolean {
  if (!getPushPublicKey()) return false;
  if (vapidConfigured) return true;
  try {
    setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    return true;
  } catch (error) {
    log.warn({ error }, 'invalid VAPID configuration; web push disabled');
    return false;
  }
}

/**
 * Fans a notification out to every subscription of the user. Push failures are
 * contained here and prune dead endpoints; callers never see them.
 */
async function sendWebPushToUser(input: CreateNotificationInput): Promise<void> {
  if (!ensureVapidConfigured()) return;

  const subscriptions = await listPushSubscriptions(input.userUuid);
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: input.title,
    body: input.message,
    icon: PUSH_ICON,
    badge: PUSH_BADGE,
    tag: `ayphr-${input.type}`,
    url: toInternalPushUrl(input.link),
  });

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        { TTL: 60 },
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      const permanent = statusCode === 404 || statusCode === 410;
      log.warn(
        { error, userUuid: input.userUuid, statusCode, permanent },
        'failed to send web push notification',
      );
      try {
        if (permanent) {
          await deletePushSubscription(input.userUuid, subscription.endpoint);
        } else {
          await recordPushSubscriptionFailure(input.userUuid, subscription.endpoint);
        }
      } catch (cleanupError) {
        log.warn({ error: cleanupError, userUuid: input.userUuid }, 'failed to prune push subscription');
      }
    }
  }));
}

/** Records an in-app notification and fans out to enabled email/push channels. */
export async function notifyUser(input: CreateNotificationInput): Promise<void> {
  const preferences = await loadNotificationPreferences(input.userUuid);

  if (isNotificationEnabled(preferences, 'inApp', input.type)) {
    try {
      await createNotification(input);
    } catch (error) {
      log.warn({ error, userUuid: input.userUuid, type: input.type }, 'failed to create notification');
    }
  }

  if (isNotificationEnabled(preferences, 'push', input.type)) {
    try {
      await sendWebPushToUser(input);
    } catch (error) {
      log.warn({ error, userUuid: input.userUuid, type: input.type }, 'failed to fan out web push');
    }
  }
}

function describeLocation(location: ReturnType<typeof resolveLocationFromClient>): string {
  const parts = [location.city, location.countryName ?? location.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

function describeDevice(userAgent?: string | null): string {
  const parsed = parseUserAgent(userAgent);
  const parts = [parsed.browser, parsed.os].filter(Boolean);
  return parts.length > 0 ? parts.join(' on ') : 'Unknown device';
}

type LoginOptions = {
  /** Email the account owner. Off by default so only untrusted sign-ins notify. */
  sendEmail?: boolean;
};

/**
 * Records a successful login as an in-app notification. Email alerts are only
 * sent when the caller marks the sign-in as coming from a new or untrusted
 * device, so repeated logins from known devices stay quiet.
 */
export async function notifyLogin(
  user: User,
  request: Request,
  meta: LoginMeta = {},
  options: LoginOptions = {},
): Promise<void> {
  const device = describeDevice(request.headers.get('user-agent'));
  const location = describeLocation(resolveLocationFromClient(meta));
  const occurredAt = new Date();

  await notifyUser({
    userUuid: user.uuid,
    type: 'login',
    title: 'New login to your account',
    message: `${device} · ${location}`,
    link: '/dashboard/settings',
  });

  if (!options.sendEmail || !user.email || !user.emailVerifiedAt) return;

  const preferences = await loadNotificationPreferences(user.uuid);
  if (!isNotificationEnabled(preferences, 'email', 'login')) return;

  try {
    const template = buildNotificationEmail({
      subject: 'New login to your Ayphr account',
      heading: 'New login',
      intro: 'A new login to your Ayphr account was detected.',
      lines: [
        `Device: ${device}`,
        `Location: ${location}`,
        `Time: ${occurredAt.toUTCString()}`,
        'If this was you, no action is needed. If not, change your password immediately.',
      ],
    });
    void sendEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
  } catch (error) {
    log.warn({ error, userUuid: user.uuid }, 'failed to build login notification email');
  }
}
