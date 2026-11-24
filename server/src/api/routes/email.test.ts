import { describe, expect, test } from 'bun:test';
import type { User } from '@common';
import { confirmEmailChange, type EmailConfirmDeps } from './email';

function user(overrides: Partial<User> = {}): User {
  return {
    uuid: 'user-1',
    username: 'user',
    email: 'old@example.com',
    role: 'user',
    auth: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastActive: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as User;
}

function makeDeps(options: {
  existing?: User | null;
  update?: (...args: any[]) => Promise<User | null>;
  invalidateUser?: () => Promise<void>;
  invalidateAuth?: () => Promise<void>;
} = {}) {
  let calls = 0;
  const collection = {
    findOneAndUpdate: options.update ?? (async (_filter: unknown, update: Record<string, any>) => {
      calls += 1;
      return { ...user(), ...update.$set } as User;
    }),
  };
  const result: EmailConfirmDeps = {
    findByEmail: async () => options.existing ?? null,
    users: async () => collection as never,
    invalidateUser: options.invalidateUser ?? (async () => {}),
    invalidateAuth: options.invalidateAuth ?? (async () => {}),
  };
  return { deps: result, get calls() { return calls; } };
}

describe('confirmEmailChange', () => {
  test('rejects an address already owned by another account', async () => {
    const harness = makeDeps({ existing: user({ uuid: 'other', email: 'taken@example.com' }) });
    const result = await confirmEmailChange(user(), 'taken@example.com', harness.deps);
    expect(result.kind).toBe('conflict');
    expect(harness.calls).toBe(0);
  });

  test('maps a unique-index race to a conflict', async () => {
    const { deps } = makeDeps({
      update: async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); },
    });
    const result = await confirmEmailChange(user(), 'new@example.com', deps);
    expect(result.kind).toBe('conflict');
  });

  test('reports a concurrent email change as stale', async () => {
    const { deps } = makeDeps({ update: async () => null });
    expect((await confirmEmailChange(user(), 'new@example.com', deps)).kind).toBe('stale');
  });

  test('updates, verifies, clears trusted devices and invalidates caches', async () => {
    let invalidatedUser = 0;
    let invalidatedAuth = 0;
    const { deps } = makeDeps({
      invalidateUser: async () => { invalidatedUser += 1; },
      invalidateAuth: async () => { invalidatedAuth += 1; },
    });

    const result = await confirmEmailChange(user(), 'new@example.com', deps);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.user.email).toBe('new@example.com');
      expect(result.user.trustedDevices).toEqual([]);
      expect(result.user.emailVerifiedAt).toBeInstanceOf(Date);
    }
    expect(invalidatedUser).toBe(1);
    expect(invalidatedAuth).toBe(1);
  });
});
