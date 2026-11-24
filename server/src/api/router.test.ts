import { describe, expect, test } from 'bun:test';
import { cleanPathname, matchRoute, normalizeApiPath } from './router';

const V1 = '/api/v1';

describe('router', () => {
  test('cleanPathname strips trailing slash', () => {
    expect(cleanPathname(`${V1}/status/`)).toBe(`${V1}/status`);
    expect(cleanPathname(`${V1}/status`)).toBe(`${V1}/status`);
  });

  test('normalizes only the current API version prefix', () => {
    expect(normalizeApiPath(`${V1}/status`)).toBe('/api/status');
    expect(normalizeApiPath(`${V1}/status/`)).toBe('/api/status');
    expect(normalizeApiPath('/api/v2/status')).toBe('/api/v2/status');
    expect(normalizeApiPath('/api/status')).toBe('/api/status');
  });

  test('matches exact versioned routes and rejects unversioned aliases', () => {
    expect(matchRoute('GET', `${V1}/status`)?.template).toBe('/api/status');
    expect(matchRoute('GET', `${V1}/devices/42/logs`)?.params.serial).toBe('42');
    expect(matchRoute('GET', '/api/status')).toBeNull();
    expect(matchRoute('GET', '/api/v2/status')).toBeNull();
  });

  test('matches parameterized route', () => {
    const match = matchRoute('GET', `${V1}/devices/pair/ABC123`);
    expect(match?.template).toBe('/api/devices/pair/:code');
    expect(match?.params.code).toBe('ABC123');
  });

  test('returns null for unknown route', () => {
    expect(matchRoute('GET', `${V1}/does-not-exist`)).toBeNull();
  });

  test('removed token route is not registered', () => {
    expect(matchRoute('POST', `${V1}/devices/token`)).toBeNull();
  });

  test('matches device data route', () => {
    const match = matchRoute('GET', `${V1}/devices/42/data`);
    expect(match?.template).toBe('/api/devices/:serial/data');
    expect(match?.params.serial).toBe('42');
  });

  test('matches device query route', () => {
    const match = matchRoute('POST', `${V1}/devices/42/query`);
    expect(match?.template).toBe('/api/devices/:serial/query');
    expect(match?.params.serial).toBe('42');
  });

  test('matches multi-device query route before parameterized device routes', () => {
    const match = matchRoute('POST', `${V1}/devices/query`);
    expect(match?.template).toBe('/api/devices/query');
  });

  test('matches the Iris query authoring route', () => {
    expect(matchRoute('POST', `${V1}/queries/assist`)?.template).toBe('/api/queries/assist');
  });

  test('matches device logs route', () => {
    const match = matchRoute('GET', `${V1}/devices/42/logs`);
    expect(match?.template).toBe('/api/devices/:serial/logs');
    expect(match?.params.serial).toBe('42');
  });

  test('matches device update and unlink routes', () => {
    const patchMatch = matchRoute('PATCH', `${V1}/devices/42`);
    expect(patchMatch?.template).toBe('/api/devices/:serial');
    expect(patchMatch?.params.serial).toBe('42');

    const deleteMatch = matchRoute('DELETE', `${V1}/devices/42`);
    expect(deleteMatch?.template).toBe('/api/devices/:serial');
    expect(deleteMatch?.params.serial).toBe('42');
  });

  test('matches notification routes before the parameterized route', () => {
    expect(matchRoute('GET', `${V1}/notifications`)?.template).toBe('/api/notifications');
    expect(matchRoute('GET', `${V1}/notifications/unread-count`)?.template).toBe('/api/notifications/unread-count');
    expect(matchRoute('POST', `${V1}/notifications/read-all`)?.template).toBe('/api/notifications/read-all');

    const readMatch = matchRoute('POST', `${V1}/notifications/abc/read`);
    expect(readMatch?.template).toBe('/api/notifications/:id/read');
    expect(readMatch?.params.id).toBe('abc');
  });
});
