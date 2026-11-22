import { describe, expect, test } from 'bun:test';
import type { Collection } from 'mongodb';
import type { Location } from '@common';
import {
  ensureDefaultLocationIndex,
  ISO_8601_REGEX,
  isPlainObject,
  normalizeDateValues,
} from './internal';

function fakeLocationsCollection(indexes: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const collection = {
    listIndexes: () => ({ toArray: async () => indexes }),
    dropIndex: async (name: string) => { calls.push(`drop:${name}`); },
    createIndex: async (key: unknown, options: unknown) => {
      calls.push(`create:${JSON.stringify({ key, options })}`);
    },
  } as unknown as Collection<Location>;
  return { collection, calls };
}

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

describe('default location index', () => {
  test('creates a unique index scoped to real team IDs', async () => {
    const { collection, calls } = fakeLocationsCollection([]);
    await ensureDefaultLocationIndex(collection);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"isDefault":true');
    expect(calls[0]).toContain('"teamId":{"$type":"string"}');
  });

  test('replaces the legacy index that collided on missing team IDs', async () => {
    const { collection, calls } = fakeLocationsCollection([{
      name: 'teamId_1_isDefault_1',
      key: { teamId: 1, isDefault: 1 },
      unique: true,
      partialFilterExpression: { isDefault: true },
    }]);
    await ensureDefaultLocationIndex(collection);
    expect(calls[0]).toBe('drop:teamId_1_isDefault_1');
    expect(calls[1]).toContain('"teamId":{"$type":"string"}');
  });

  test('leaves an already scoped index untouched', async () => {
    const { collection, calls } = fakeLocationsCollection([{
      name: 'teamId_1_isDefault_1',
      key: { teamId: 1, isDefault: 1 },
      unique: true,
      partialFilterExpression: { isDefault: true, teamId: { $type: 'string' } },
    }]);
    await ensureDefaultLocationIndex(collection);
    expect(calls).toEqual([]);
  });
});