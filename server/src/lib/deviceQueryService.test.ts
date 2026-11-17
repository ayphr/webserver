import { describe, expect, test } from 'bun:test';
import { createDeviceQueryPlan } from './deviceQueryService';

describe('device query service', () => {
  const features = { queryComputeUnitLimit: 150, queryCostCredits: 0.5 };

  test('normalizes valid queries and calculates cost', () => {
    const plan = createDeviceQueryPlan('  findAll(p -> {tempC > 20})  ', 10, features);
    expect(plan.query).toBe('findAll(p -> {tempC > 20})');
    expect(plan.computeUnits).toBeGreaterThan(0);
    expect(plan.creditCost).toBeGreaterThanOrEqual(0.1);
  });

  test('rejects empty and over-limit queries', () => {
    expect(() => createDeviceQueryPlan(' ', 10, features)).toThrow('query is required');
    expect(() => createDeviceQueryPlan('x'.repeat(10_001), 10, features)).toThrow('characters or fewer');
  });
});
