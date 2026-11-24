import { describe, expect, test } from 'bun:test';
import { deviceVerificationFailure } from './auth';

describe('new-device verification fails closed', () => {
  test('email delivery not configured returns 503 without issuing a session', async () => {
    const response = deviceVerificationFailure({ status: 'not_configured' });
    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ verificationUnavailable: true });
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('requiresDeviceVerification');
  });

  test('send failure returns 502 and no trusted-device response', async () => {
    const response = deviceVerificationFailure({ status: 'send_failed' });
    expect(response.status).toBe(502);
    const body = await response.json() as Record<string, unknown>;
    expect(body.verificationUnavailable).toBe(true);
  });

  test('rate limiting preserves the retry-after response', () => {
    const response = deviceVerificationFailure({ status: 'rate_limited', retryAfterMs: 5000 });
    expect(response.status).toBe(429);
  });
});
