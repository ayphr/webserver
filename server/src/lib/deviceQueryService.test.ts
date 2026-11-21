import { describe, expect, test } from 'bun:test';
import { createDeviceQueryPlan } from './deviceQueryService';

describe('device query service', () => {
  const features = {
    queryComputeUnitLimit: 150,
    queryCostCredits: 0.5,
    boostedQueryCostCredits: 2,
  };

  test('normalizes valid queries and calculates cost', () => {
    const plan = createDeviceQueryPlan('  findAll(p -> {p.tempC > 20})  ', 10, features);
    expect(plan.query).toBe('findAll(p -> {p.tempC > 20})');
    expect(plan.computeUnits).toBeGreaterThan(0);
    expect(plan.creditCost).toBeGreaterThanOrEqual(0.1);
  });

  test('rejects empty and over-limit queries', () => {
    expect(() => createDeviceQueryPlan(' ', 10, features)).toThrow('query is required');
    expect(() => createDeviceQueryPlan('x'.repeat(10_001), 10, features)).toThrow('characters or fewer');
  });

  test('rejects fields without a lambda selector', () => {
    expect(() => createDeviceQueryPlan('findAll(p -> {temperature > 20})', 10, features))
      .toThrow(/must include the lambda variable/);
    expect(() => createDeviceQueryPlan('findAll() then sortDescending(timestamp)', 10, features))
      .toThrow(/must use a selector/);
  });

  test('charges boost queries at the boosted plan rate', () => {
    const standard = createDeviceQueryPlan('findAll(p -> {p.tempC > 20})', 1000, features);
    const boost = createDeviceQueryPlan('findAll(p -> {p.tempC > 20})', 1000, features, 'boost');

    expect(standard.type).toBe('standard');
    expect(standard.creditRate).toBe(0.5);
    expect(boost.type).toBe('boost');
    expect(boost.creditRate).toBe(2);
    expect(boost.creditCost).toBeCloseTo(standard.creditCost * 4);
    expect(boost.computeUnits).toBe(standard.computeUnits);
  });
});
