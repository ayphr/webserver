import { describe, expect, test } from 'bun:test';
import { loadQueryAuthorDeviceData } from './queryAuthorData';

const currentFrom = '2026-01-01T00:00:00.000Z';
const currentTo = '2026-01-02T00:00:00.000Z';
const availableFrom = '2025-01-01T00:00:00.000Z';
const availableTo = '2025-01-02T00:00:00.000Z';

const point = (at: string, temperature: number) => ({
  timestamp: new Date(at),
  temperature,
  humidity: 50,
  airPressure: 1000,
});

describe('loadQueryAuthorDeviceData', () => {
  test('reports all-time availability and samples it when the current range is empty', async () => {
    const readRanges: Array<{ since?: Date; until?: Date }> = [];
    const result = await loadQueryAuthorDeviceData(
      [{ serial: 123, name: 'Lab Sensor' }],
      currentFrom,
      currentTo,
      {
        summarize: async () => [{
          serial: 123,
          count: 2,
          firstAt: new Date(availableFrom),
          lastAt: new Date(availableTo),
        }],
        count: async () => 0,
        read: async (_serial, options) => {
          readRanges.push(options ?? {});
          return {
            points: [point(availableFrom, 18), point(availableTo, 24)],
            totalCount: 2,
          };
        },
      },
    );

    expect(result.totalPointCount).toBe(0);
    expect(result.availablePointCount).toBe(2);
    expect(result.availableFrom).toBe(availableFrom);
    expect(result.availableTo).toBe(availableTo);
    expect(result.devices[0]?.pointCount).toBe(0);
    expect(result.devices[0]?.availablePointCount).toBe(2);
    expect(result.devices[0]?.firstAt).toBe(availableFrom);
    expect(result.devices[0]?.lastAt).toBe(availableTo);
    expect(result.devices[0]?.sample).toHaveLength(2);
    expect(readRanges[0]?.since?.toISOString()).toBe(availableFrom);
    expect(readRanges[0]?.until?.toISOString()).toBe(availableTo);
  });

  test('keeps the current range when it contains readings', async () => {
    const readRanges: Array<{ since?: Date; until?: Date }> = [];
    const result = await loadQueryAuthorDeviceData(
      [{ serial: 123, name: 'Lab Sensor' }],
      currentFrom,
      currentTo,
      {
        summarize: async () => [{
          serial: 123,
          count: 20,
          firstAt: new Date(availableFrom),
          lastAt: new Date(currentTo),
        }],
        count: async () => 2,
        read: async (_serial, options) => {
          readRanges.push(options ?? {});
          return {
            points: [point(currentFrom, 21), point(currentTo, 23)],
            totalCount: 2,
          };
        },
      },
    );

    expect(result.totalPointCount).toBe(2);
    expect(result.devices[0]?.firstAt).toBe(currentFrom);
    expect(readRanges[0]?.since?.toISOString()).toBe(currentFrom);
    expect(readRanges[0]?.until?.toISOString()).toBe(currentTo);
  });

  test('marks devices without any readings as having no available range', async () => {
    const result = await loadQueryAuthorDeviceData(
      [{ serial: 123, name: 'Lab Sensor' }],
      currentFrom,
      currentTo,
      {
        summarize: async () => [{ serial: 123, count: 0, firstAt: null, lastAt: null }],
        count: async () => 0,
        read: async () => ({ points: [], totalCount: 0 }),
      },
    );

    expect(result.availablePointCount).toBe(0);
    expect(result.availableFrom).toBeUndefined();
    expect(result.availableTo).toBeUndefined();
    expect(result.devices[0]?.availablePointCount).toBe(0);
    expect(result.devices[0]?.sample).toBeUndefined();
  });
});
