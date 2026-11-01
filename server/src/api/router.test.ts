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

  test('matches device data route', () => {
    const match = matchRoute('GET', '/api/devices/42/data');
    expect(match?.template).toBe('/api/devices/:serial/data');
    expect(match?.params.serial).toBe('42');
  });

  test('matches device update and unlink routes', () => {
    const patchMatch = matchRoute('PATCH', '/api/devices/42');
    expect(patchMatch?.template).toBe('/api/devices/:serial');
    expect(patchMatch?.params.serial).toBe('42');

    const deleteMatch = matchRoute('DELETE', '/api/devices/42');
    expect(deleteMatch?.template).toBe('/api/devices/:serial');
    expect(deleteMatch?.params.serial).toBe('42');
  });
});