import { RESEND_API_KEY, RESEND_FROM_EMAIL } from '../../env';
import { createLogger } from '../logger';

const log = createLogger('email');

const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails';

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { sent: true } | { sent: false; reason: 'not_configured' | 'send_failed' };

export function isEmailSendingConfigured(): boolean {
  return RESEND_API_KEY.length > 0;
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!isEmailSendingConfigured()) {
    log.warn({ to: options.to, subject: options.subject }, 'email sending is not configured (RESEND_API_KEY missing)');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const response = await fetch(RESEND_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.error({ to: options.to, subject: options.subject, status: response.status, body }, 'email send failed');
      return { sent: false, reason: 'send_failed' };
    }

    return { sent: true };
  } catch (error) {
    log.error({ error }, 'email send request failed');
    return { sent: false, reason: 'send_failed' };
  }
}