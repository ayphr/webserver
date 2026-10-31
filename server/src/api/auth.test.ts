import { describe, expect, test } from 'bun:test';
import { getExpiryDate } from './auth';

describe('auth helpers', () => {
  test('getExpiryDate returns a future date', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiry = getExpiryDate(now);
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
  });
});