import { describe, expect, test } from 'bun:test';
import { isSessionDeviceType, parseUserAgent, resolveLocationFromClient } from './session';

describe('session helpers', () => {
  test('isSessionDeviceType validates known types', () => {
    expect(isSessionDeviceType('phone')).toBe(true);
    expect(isSessionDeviceType('desktop')).toBe(true);
    expect(isSessionDeviceType('fridge')).toBe(false);
    expect(isSessionDeviceType(42)).toBe(false);
  });

  test('resolveLocationFromClient returns empty for no input', () => {
    expect(resolveLocationFromClient({})).toEqual({});
  });

  test('resolveLocationFromClient resolves country from timezone', () => {
    const loc = resolveLocationFromClient({ timezone: 'America/New_York' });
    expect(loc.country).toBe('US');
    expect(loc.timezone).toBe('America/New_York');
    expect(loc.city).toBe('New York');
  });

  test('resolveLocationFromClient rejects invalid timezone', () => {
    const loc = resolveLocationFromClient({ timezone: 'Not/A/Real/Zone/XYZ' });
    expect(loc.timezone).toBeUndefined();
  });

  test('parseUserAgent detects chrome on windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const parsed = parseUserAgent(ua);
    expect(parsed.browser).toContain('Chrome');
    expect(parsed.os).toBe('Windows 10.0');
    expect(parsed.deviceType).toBe('desktop');
  });

  test('parseUserAgent returns empty for null', () => {
    expect(parseUserAgent(null)).toEqual({});
    expect(parseUserAgent(undefined)).toEqual({});
  });
});