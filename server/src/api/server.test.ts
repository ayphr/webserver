import { describe, expect, test } from 'bun:test';
import { isAllowedUpgradeOrigin, resolveClientIp } from './server';

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://api.example.com/api/status', { headers });
}

describe('resolveClientIp', () => {
  test('uses the socket address when proxy trust is disabled', () => {
    expect(resolveClientIp(request({ 'x-forwarded-for': '1.1.1.1' }), '127.0.0.1', false)).toBe('127.0.0.1');
  });

  test('uses the last forwarded hop by default', () => {
    const req = request({ 'x-forwarded-for': '1.1.1.1, 203.0.113.10' });
    expect(resolveClientIp(req, '127.0.0.1', true)).toBe('203.0.113.10');
  });

  test('honors an explicit number of trusted rightmost hops', () => {
    const req = request({ 'x-forwarded-for': '1.1.1.1, 198.51.100.4, 203.0.113.10' });
    expect(resolveClientIp(req, '127.0.0.1', true, 2)).toBe('198.51.100.4');
  });

  test('falls back to the socket when no forwarded value is present', () => {
    expect(resolveClientIp(request(), '127.0.0.1', true)).toBe('127.0.0.1');
  });
});

describe('WebSocket upgrade Origin allowlist', () => {
  const allowed = ['https://ayphr.com', 'https://www.ayphr.com'];

  test('accepts an allowlisted origin', () => {
    expect(isAllowedUpgradeOrigin(request({ origin: 'https://ayphr.com' }), allowed)).toBe(true);
  });

  test('rejects missing, malformed and foreign origins', () => {
    expect(isAllowedUpgradeOrigin(request(), allowed)).toBe(false);
    expect(isAllowedUpgradeOrigin(request({ origin: 'not-a-url' }), allowed)).toBe(false);
    expect(isAllowedUpgradeOrigin(request({ origin: 'https://evil.example' }), allowed)).toBe(false);
    // A lookalike host must not pass by suffix matching.
    expect(isAllowedUpgradeOrigin(request({ origin: 'https://ayphr.com.evil.example' }), allowed)).toBe(false);
  });
});
