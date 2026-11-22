import { describe, expect, test } from 'bun:test';
import { parsePushSubscription } from './notifications';

const P256DH = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9S9BO9Udk8NQmxfJzSMUq7gQ1mJiK9dVhSzxqQGvV1x8l0lRtPjrZ0wWU';
const AUTH = 'k8H9sQ2vL7mN4pT6wY1zRQ';

function subscription(endpoint: string) {
  return { endpoint, keys: { p256dh: P256DH, auth: AUTH } };
}

describe('parsePushSubscription', () => {
  test('accepts known push service endpoints', () => {
    const input = subscription('https://fcm.googleapis.com/fcm/send/some-device-token');
    expect(parsePushSubscription(input)).toEqual(input);
  });

  test('rejects non-HTTPS and non-allowlisted hosts', () => {
    expect(() => parsePushSubscription(subscription('http://fcm.googleapis.com/fcm/send/token'))).toThrow();
    expect(() => parsePushSubscription(subscription('https://evil.example.com/push'))).toThrow();
    expect(() => parsePushSubscription(subscription('https://fcm.googleapis.com.evil.com/push'))).toThrow();
  });

  test('rejects malformed keys and unknown fields', () => {
    const input = subscription('https://fcm.googleapis.com/fcm/send/token');
    expect(() => parsePushSubscription({ ...input, unexpected: true })).toThrow();
    expect(() => parsePushSubscription({ ...input, keys: { ...input.keys, auth: 'short' } })).toThrow();
    expect(() => parsePushSubscription({
      endpoint: input.endpoint,
      keys: { ...input.keys, extra: 'value' },
    })).toThrow();
  });
});
