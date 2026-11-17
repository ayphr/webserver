import { describe, expect, test } from 'bun:test';
import { isTrustedDevice, shouldVerifyNewDevice } from './authIdentityService';

describe('auth identity service', () => {
  test('distinguishes trusted and new devices', () => {
    const user = {
      trustedDevices: ['device-a'],
      email: 'user@example.com',
      emailVerifiedAt: new Date(),
    };

    expect(isTrustedDevice(user, 'device-a')).toBe(true);
    expect(shouldVerifyNewDevice(user, 'device-b')).toBe(true);
    expect(shouldVerifyNewDevice(user, 'device-a')).toBe(false);
  });
});
