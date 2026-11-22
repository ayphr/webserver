import type { User } from '@common';
import { createPasswordHash, endAllSessions } from '../api/auth';
import { updateUser } from './db';
import { buildNotificationEmail, sendEmail } from './email';
import { notifyUser } from './notifications';

export async function changeUserPassword(user: User, newPassword: string): Promise<void> {
  user.auth.passwordHash = await createPasswordHash(newPassword);
  user.trustedDevices = [];
  await updateUser(user);
  await endAllSessions(user);

  await notifyUser({
    userUuid: user.uuid,
    type: 'security',
    title: 'Your password was changed',
    message: 'The password for your account was changed and all devices were signed out.',
    link: '/dashboard/settings',
  });

  if (user.email) {
    const template = buildNotificationEmail({
      subject: 'Your Ayphr password was changed',
      heading: 'Password changed',
      intro: 'The password for your Ayphr account was just changed.',
      lines: ['If you made this change, no further action is needed.'],
    });
    void sendEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
  }
}
