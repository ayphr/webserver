import { describe, expect, test } from 'bun:test';
import { decodeCacheValue, encodeCacheValue } from './cache';

describe('cache encoding', () => {
  test('round-trips plain objects', () => {
    const value = { a: 1, b: 'two', c: [3, 4] };
    const raw = encodeCacheValue(value);
    expect(decodeCacheValue(raw)).toEqual(value as never);
  });

  test('round-trips Date values', () => {
    const now = new Date('2026-01-02T03:04:05.000Z');
    const value = { when: now, nested: { at: now } };
    const raw = encodeCacheValue(value);
    const decoded = decodeCacheValue<{ when: Date; nested: { at: Date } }>(raw);
    expect(decoded?.when).toBeInstanceOf(Date);
    expect(decoded?.when.getTime()).toBe(now.getTime());
    expect(decoded?.nested.at.getTime()).toBe(now.getTime());
  });

  test('decodeCacheValue returns null for invalid JSON', () => {
    expect(decodeCacheValue('not json')).toBeNull();
  });

  test('decodeCacheValue returns null for empty-ish input', () => {
    expect(decodeCacheValue('')).toBeNull();
  });
});