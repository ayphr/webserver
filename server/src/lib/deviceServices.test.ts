import { describe, expect, test } from 'bun:test';
import { generateDevicePairingCode } from './devicePairingService';
import { toPresentedDeviceToken } from './deviceTokenService';

describe('device services', () => {
  test('generates pairing codes from the configured alphabet', () => {
    const code = generateDevicePairingCode(() => 0);
    expect(code).toHaveLength(6);
    expect(code).toBe('AAAAAA');
  });

  test('removes token hashes from public token projections', () => {
    const token = toPresentedDeviceToken({
      id: 'token-1',
      serial: 42,
      teamId: 'team-1',
      tokenHash: 'secret',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      location: {},
      active: true,
      lastUsedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(token).not.toHaveProperty('tokenHash');
    expect(token.status).toBe('active');
    expect(token.lastUsed).toEqual(token.lastUsedAt);
  });
});
