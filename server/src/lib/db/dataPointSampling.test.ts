import { describe, expect, test } from 'bun:test';
import { sampleDataPoints, sortDataPoints, toDataPoint } from './dataPointSampling';

function document(timestamp: string, value: number) {
  return {
    timestamp: new Date(timestamp),
    temperature: value,
    humidity: value,
    airPressure: value,
    deviceSerial: 1,
  };
}

describe('data point sampling', () => {
  test('projects stored documents without persistence fields', () => {
    expect(toDataPoint(document('2024-01-01T00:00:00.000Z', 1))).toEqual({
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      temperature: 1,
      humidity: 1,
      airPressure: 1,
    });
  });

  test('keeps bounded samples ordered and includes the final point', () => {
    const points = [1, 2, 3, 4, 5].map((value) => document(`2024-01-0${value}T00:00:00.000Z`, value));
    const sampled = sampleDataPoints(points, 3);
    expect(sampled).toHaveLength(3);
    expect(sampled[0]?.temperature).toBe(1);
    expect(sampled[2]?.temperature).toBe(5);
  });

  test('sorts points by timestamp without mutating input', () => {
    const points = [
      { timestamp: new Date('2024-01-02T00:00:00.000Z'), temperature: 2, humidity: 2, airPressure: 2 },
      { timestamp: new Date('2024-01-01T00:00:00.000Z'), temperature: 1, humidity: 1, airPressure: 1 },
    ];
    expect(sortDataPoints(points).map((point) => point.temperature)).toEqual([1, 2]);
    expect(points[0]?.temperature).toBe(2);
  });
});
