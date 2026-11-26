import { describe, expect, test } from 'bun:test';
import { shouldPersistQueryKey } from './persist';
import { queryKeys } from './keys';

describe('shouldPersistQueryKey', () => {
  test('excludes device data points', () => {
    expect(shouldPersistQueryKey(queryKeys.deviceDataPoints(1, { from: 'a' }))).toBe(false);
  });

  test('excludes location history/data points keys', () => {
    expect(shouldPersistQueryKey(['locationHistory', 'loc1'])).toBe(false);
    expect(shouldPersistQueryKey(['locationDataPoints', 'loc1', { period: '24h' }])).toBe(false);
  });

  test('includes normal list/bootstrap keys', () => {
    expect(shouldPersistQueryKey(queryKeys.bootstrap())).toBe(true);
    expect(shouldPersistQueryKey(queryKeys.devicesMine())).toBe(true);
    expect(shouldPersistQueryKey(queryKeys.locationsMine())).toBe(true);
    expect(shouldPersistQueryKey(queryKeys.notificationsUnread())).toBe(true);
  });
});
