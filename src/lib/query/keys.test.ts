import { describe, expect, test } from 'bun:test';
import { queryKeys } from './keys';
import { shouldPersistQueryKey } from './persist';

describe('queryKeys', () => {
  test('bootstrap key is stable', () => {
    expect(queryKeys.bootstrap()).toEqual(['bootstrap']);
  });

  test('device data points key is excluded from persistence', () => {
    expect(shouldPersistQueryKey(queryKeys.deviceDataPoints(12, { period: '24h' }))).toBe(false);
    expect(shouldPersistQueryKey(queryKeys.devicesMine())).toBe(true);
  });
});
