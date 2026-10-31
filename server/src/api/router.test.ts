import { describe, expect, test } from 'bun:test';
import { cleanPathname, matchRoute } from './router';

describe('router', () => {
  test('cleanPathname strips trailing slash', () => {
    expect(cleanPathname('/api/status/')).toBe('/api/status');
    expect(cleanPathname('/api/status')).toBe('/api/status');
  });

  test('matches exact route', () => {
    const match = matchRoute('GET', '/api/status');
    expect(match?.template).toBe('/api/status');
  });

  test('matches parameterized route', () => {
    const match = matchRoute('GET', '/api/devices/pair/ABC123');
    expect(match?.template).toBe('/api/devices/pair/:code');
    expect(match?.params.code).toBe('ABC123');
  });

  test('returns null for unknown route', () => {
    expect(matchRoute('GET', '/api/does-not-exist')).toBeNull();
  });

  test('removed token route is not registered', () => {
    expect(matchRoute('POST', '/api/devices/token')).toBeNull();
  });
});