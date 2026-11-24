import { describe, expect, it } from 'bun:test';
import { API_PATHS, API_ROUTES, API_VERSION, apiPath } from './routes';

describe('generated API route manifest', () => {
  it('publishes versioned routes with unique operation ids', () => {
    expect(API_VERSION).toBe('v1');
    expect(API_ROUTES.length).toBeGreaterThan(0);
    expect(new Set(API_ROUTES.map((route) => route.operationId)).size).toBe(API_ROUTES.length);
    expect(API_ROUTES.every((route) => route.path.startsWith('/api/v1'))).toBe(true);
  });

  it('resolves path params and query strings', () => {
    expect(apiPath(API_PATHS.getStatus)).toBe('/api/v1/status');
    expect(apiPath(API_PATHS.getDevicesSerial, { serial: 42 })).toBe('/api/v1/devices/42');
    expect(apiPath(API_PATHS.getDevicesSerial, { serial: 42 }, 'from=2026-01-01'))
      .toBe('/api/v1/devices/42?from=2026-01-01');
    expect(apiPath(API_PATHS.getStatus, {}, '?verbose=1')).toBe('/api/v1/status?verbose=1');
  });

  it('encodes unsafe param values', () => {
    expect(apiPath(API_PATHS.getUsersUuid, { uuid: 'a/b c' })).toBe('/api/v1/users/a%2Fb%20c');
  });
});
