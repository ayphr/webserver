import { describe, expect, test } from 'bun:test';
import {
  calculateDataFillCreditCost,
  calculateQueryCreditCost,
  generateSyntheticDataPointBatches,
  resolveDeviceTimeRange,
} from './deviceDataService';

describe('device data service', () => {
  test('resolves explicit and relative time ranges', () => {
    const now = Date.parse('2026-01-02T00:00:00.000Z');
    expect(resolveDeviceTimeRange('1h', null, null, now).since?.getTime()).toBe(now - 3_600_000);
    expect(resolveDeviceTimeRange('all', null, null, now).since).toBeUndefined();
    expect(resolveDeviceTimeRange('24h', '2026-01-01T12:00:00.000Z', '2026-01-02T00:00:00.000Z', now))
      .toEqual({ since: new Date('2026-01-01T12:00:00.000Z'), until: new Date('2026-01-02T00:00:00.000Z') });
  });

  test('applies minimum credit costs', () => {
    expect(calculateQueryCreditCost(0, { queryCostCredits: 0.5 })).toBe(0.1);
    expect(calculateDataFillCreditCost(1000, { dataFillCreditCostPerThousandPoints: 0.75 })).toBe(0.75);
  });

  test('generates bounded batches with valid sensor ranges', () => {
    const batches = [...generateSyntheticDataPointBatches(Date.now(), 7, 60, 3)];
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
    const points = batches.flat();
    expect(points).toHaveLength(7);
    expect(points.every((point) => point.humidity >= 15 && point.humidity <= 99)).toBe(true);
    expect(points.every((point) => point.airPressure >= 980 && point.airPressure <= 1042)).toBe(true);
  });
});
