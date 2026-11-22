import { describe, expect, test } from 'bun:test';
import { isGlobalRateLimitExempt } from './globalRateLimit';
import { LEGACY_API_TEMPLATE, UNMATCHED_API_TEMPLATE } from './version';

const V1 = '/api/v1';

describe('global rate limit exemptions', () => {
  test('exempts health, docs, preflight, and non-API paths', () => {
    expect(isGlobalRateLimitExempt('GET', `${V1}/status`, '/api/status')).toBe(true);
    expect(isGlobalRateLimitExempt('GET', `${V1}/ready`, '/api/ready')).toBe(true);
    expect(isGlobalRateLimitExempt('GET', `${V1}/openapi.json`, '/api/openapi.json')).toBe(true);
    expect(isGlobalRateLimitExempt('OPTIONS', `${V1}/devices`, UNMATCHED_API_TEMPLATE)).toBe(true);
    expect(isGlobalRateLimitExempt('GET', '/', '/other')).toBe(true);
  });

  test('exempts routes with dedicated limiters and static avatars', () => {
    expect(isGlobalRateLimitExempt('POST', `${V1}/auth/login`, '/api/auth/login')).toBe(true);
    expect(isGlobalRateLimitExempt('POST', `${V1}/devices/data`, '/api/devices/data')).toBe(true);
    expect(isGlobalRateLimitExempt('GET', `${V1}/avatars/abc`, '/api/avatars/:uuid')).toBe(true);
  });

  test('limits previously uncovered API routes and unmatched paths', () => {
    expect(isGlobalRateLimitExempt('GET', `${V1}/staff/users`, '/api/staff/users')).toBe(false);
    expect(isGlobalRateLimitExempt('POST', `${V1}/integrations`, '/api/integrations')).toBe(false);
    expect(isGlobalRateLimitExempt('GET', `${V1}/notifications`, '/api/notifications')).toBe(false);
    expect(isGlobalRateLimitExempt('GET', `${V1}/missing`, UNMATCHED_API_TEMPLATE)).toBe(false);
    expect(isGlobalRateLimitExempt('GET', '/api/missing', LEGACY_API_TEMPLATE)).toBe(false);
  });
});
