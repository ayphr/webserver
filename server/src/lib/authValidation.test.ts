import { describe, expect, test } from 'bun:test';
import { validateAuthPayload } from './authValidation';

describe('auth validation', () => {
  test('normalizes supported fields and preserves payload data', () => {
    const payload = validateAuthPayload({
      username: ' user ',
      password: ' secret ',
      acceptPolicies: true,
      inviteToken: ' invite ',
      ignored: 'value',
    });

    expect(payload.username).toBe('user');
    expect(payload.password).toBe(' secret ');
    expect(payload.acceptPolicies).toBe(true);
    expect(payload.inviteToken).toBe('invite');
    expect(payload.ignored).toBe('value');
  });

  test('rejects non-object payloads', () => {
    expect(() => validateAuthPayload(null)).toThrow();
  });
});
