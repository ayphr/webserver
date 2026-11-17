import { describe, expect, test } from 'bun:test';
import { buildDataPointFilter } from './dataPointFilters';

describe('data point filters', () => {
  test('builds a serial-only filter without a range', () => {
    expect(buildDataPointFilter(42)).toEqual({ deviceSerial: 42 });
  });

  test('adds only supplied range bounds', () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    const until = new Date('2026-01-02T00:00:00.000Z');
    expect(buildDataPointFilter(42, { since, until })).toEqual({
      deviceSerial: 42,
      timestamp: { $gte: since, $lte: until },
    });
  });
});
