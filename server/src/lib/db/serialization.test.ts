import { describe, expect, test } from 'bun:test';
import { ISO_8601_REGEX, isPlainObject, normalizeDateValues } from './serialization';

describe('database serialization', () => {
  test('recognizes full ISO timestamps only', () => {
    expect(ISO_8601_REGEX.test('2026-01-02T03:04:05.000Z')).toBe(true);
    expect(ISO_8601_REGEX.test('2026-01-02')).toBe(false);
  });

  test('identifies plain objects without treating arrays as records', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });

  test('normalizes nested valid ISO values while preserving other values', () => {
    const result = normalizeDateValues({
      date: '2026-01-02T03:04:05.000Z',
      nested: [{ date: 'not-a-date' }],
      count: 2,
    });

    expect(result.date).toBeInstanceOf(Date);
    expect(result.nested[0]?.date).toBe('not-a-date');
    expect(result.count).toBe(2);
  });
});
