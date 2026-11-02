import { describe, expect, test } from 'bun:test';
import { hashToken } from './tokens';

describe('tokens', () => {
  test('hashToken is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  test('hashToken produces a 64-char hex sha256', () => {
    const h = hashToken('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashToken differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});