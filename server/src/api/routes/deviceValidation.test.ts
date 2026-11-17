import { describe, expect, test } from 'bun:test';
import { getDeviceToken, parseDataPoints, parseName, parseSerial, parseTimestamp } from './deviceValidation';

describe('device validation', () => {
  test('parses bounded serials and names', () => {
    expect(parseSerial('42')).toBe(42);
    expect(parseSerial(-1)).toBeNull();
    expect(parseSerial('not-a-serial')).toBeNull();
    expect(parseName('  Kitchen  ')).toBe('Kitchen');
    expect(parseName('')).toBeNull();
  });

  test('normalizes timestamps to whole seconds', () => {
    expect(parseTimestamp('2026-01-01T00:00:00.900Z')?.toISOString()).toBe('2026-01-01T00:00:01.000Z');
    expect(parseTimestamp('invalid')).toBeNull();
  });

  test('deduplicates telemetry by normalized timestamp', () => {
    const points = parseDataPoints([
      { timestamp: '2026-01-01T00:00:00.100Z', temperature: 20, humidity: 50, airPressure: 1013 },
      { timestamp: '2026-01-01T00:00:00.200Z', temperature: 21, humidity: 51, airPressure: 1014 },
    ]);

    expect(points).toHaveLength(1);
    expect(points?.[0]?.temperature).toBe(21);
  });

  test('extracts trimmed upload tokens', () => {
    expect(getDeviceToken({ token: '  secret  ' })).toBe('secret');
    expect(getDeviceToken({ token: ' ' })).toBeNull();
  });
});
