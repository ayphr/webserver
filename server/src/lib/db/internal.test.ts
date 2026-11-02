import { describe, expect, test } from 'bun:test';
import { ISO_8601_REGEX, isPlainObject, normalizeDateValues } from './internal';

describe('db internal helpers', () => {
  test('ISO_8601_REGEX matches ISO strings', () => {
    expect(ISO_8601_REGEX.test('2026-01-02T03:04:05.000Z')).toBe(true);
    expect(ISO_8601_REGEX.test('2026-01-02T03:04:05+02:00')).toBe(true);
    expect(ISO_8601_REGEX.test('not-a-date')).toBe(false);
    expect(ISO_8601_REGEX.test('2026-01-02')).toBe(false);
  });

  test('isPlainObject identifies plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('x')).toBe(false);
  });

  test('normalizeDateValues converts ISO strings to Dates', () => {
    const out = normalizeDateValues({ when: '2026-01-02T03:04:05.000Z', n: 5 }) as unknown as { when: Date; n: number };
    expect(out.when).toBeInstanceOf(Date);
    expect(out.n).toBe(5);
  });

  test('normalizeDateValues handles arrays and nested objects', () => {
    const out = normalizeDateValues([{ t: '2026-01-02T03:04:05.000Z' }]) as unknown as { t: Date }[];
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]!.t).toBeInstanceOf(Date);
  });
});