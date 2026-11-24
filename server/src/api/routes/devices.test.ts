import { describe, expect, test } from 'bun:test';
import type { User } from '@common';
import type { DeviceDocument } from '../../lib/db/internal';
import {
  resolvePairingOwnership,
  validateExportSpan,
} from './devices';

function user(overrides: Partial<User> = {}): User {
  return { uuid: 'user-1', username: 'user', role: 'user', auth: {}, ...overrides } as User;
}

function device(teamId: string): DeviceDocument {
  return {
    serial: 42,
    teamId,
    ownerUsername: 'owner',
    registeredAt: new Date(),
    tokenHash: 'hash',
    tokenCreatedAt: new Date(),
  };
}

describe('device pairing ownership policy', () => {
  const deps = {
    getDevice: async (serial: number) => (serial === 42 ? device('team-1') : null),
    scopeUuid: async () => 'team-1',
    scopeUsername: async () => 'owner',
  };

  test('an authenticated user cannot pair a serial owned by another team', async () => {
    const outcome = await resolvePairingOwnership(42, user(), {
      ...deps,
      scopeUuid: async () => 'team-2',
    });
    expect(outcome.kind).toBe('foreign_serial');
  });

  test('an authenticated owner is stamped on the pairing', async () => {
    const outcome = await resolvePairingOwnership(42, user(), deps);
    expect(outcome).toEqual({ kind: 'allowed', teamId: 'team-1', ownerUsername: 'owner' });
  });

  test('legacy unauthenticated pairing still works for backwards compatibility', async () => {
    const outcome = await resolvePairingOwnership(42, null, deps);
    expect(outcome).toEqual({ kind: 'allowed', teamId: 'team-1' });
  });

  test('unregistered serials are allowed', async () => {
    const outcome = await resolvePairingOwnership(99, user(), deps);
    expect(outcome).toEqual({ kind: 'allowed' });
  });
});

describe('export range bound', () => {
  const from = new Date('2026-01-01T00:00:00Z');

  test('accepts bounded and open-ended ranges', () => {
    expect(validateExportSpan(from, new Date(from.getTime() + 10 * 86_400_000))).toBeNull();
    expect(validateExportSpan(from, undefined)).toBeNull();
  });

  test('rejects an oversized range', () => {
    expect(validateExportSpan(from, new Date(from.getTime() + 90 * 86_400_000))).toContain('or fewer');
  });
});
