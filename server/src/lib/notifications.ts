import type { User } from '@common';
import { createNotification, type CreateNotificationInput } from './db/notifications';
import { buildNotificationEmail, sendEmail } from './email';
import { parseUserAgent, resolveLocationFromClient } from './session';
import { createLogger } from './logger';

const log = createLogger('notifications');

type LoginMeta = {
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

/** Creates an in-app notification without letting a failure break the caller. */
export async function notifyUser(input: CreateNotificationInput): Promise<void> {
  try {
    await createNotification(input);
  } catch (error) {
    log.warn({ error, userUuid: input.userUuid, type: input.type }, 'failed to create notification');
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
    link: '/dashboard?tab=account-settings',
  });

  if (!options.sendEmail || !user.email || !user.emailVerifiedAt) return;

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
