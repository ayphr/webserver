import { describe, expect, test } from 'bun:test';
import { shouldPrefetch } from './prefetch';

describe('prefetch', () => {
  test('does not prefetch timeseries by default', () => {
    expect(shouldPrefetch('deviceDataPoints')).toBe(false);
    expect(shouldPrefetch('locationHistory')).toBe(false);
  });

  test('prefetches normal keys', () => {
    expect(shouldPrefetch('devices')).toBe(true);
    expect(shouldPrefetch('bootstrap')).toBe(true);
  });
});
