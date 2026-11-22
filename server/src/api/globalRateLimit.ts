import { LEGACY_API_TEMPLATE, UNMATCHED_API_TEMPLATE } from './version';
import { getClientIp } from '../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../lib/rateLimit';

/**
 * Coarse per-IP ceiling for every API route that does not already have a
 * dedicated limiter. A tighter bucket covers unmatched paths so scanners do
 * not get a free pass.
 */
const apiLimiter = createRateLimiter(5 * 60_000, 1000, 'global-api');
const unmatchedLimiter = createRateLimiter(5 * 60_000, 200, 'global-api-unmatched');

const EXEMPT_TEMPLATES = new Set([
  '/api/status',
  '/api/ready',
  '/api/openapi.json',

  // Dedicated limiters already cover these paths.
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/login/verify',
  '/api/auth/email/code',
  '/api/auth/email/change',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/devices/pair',
  '/api/devices/pair/:code',
  '/api/devices/link',
  '/api/devices/data',
  '/api/devices/query',
  '/api/devices/:serial/query',
  '/api/devices/:serial/alerts/:id/test',

  // Stripe retries come from a small set of shared addresses.
  '/api/subscriptions/stripe/webhook',
]);

export function isGlobalRateLimitExempt(method: string, pathname: string, template: string): boolean {
  if (method === 'OPTIONS') return true;
  if (!pathname.startsWith('/api/') && pathname !== '/api') return true;
  if (method === 'GET' && template === '/api/avatars/:uuid') return true;
  return EXEMPT_TEMPLATES.has(template);
}

export async function applyGlobalRateLimit(
  request: Request,
  method: string,
  pathname: string,
  template: string,
): Promise<Response | null> {
  if (isGlobalRateLimitExempt(method, pathname, template)) return null;

  const limiter = template === UNMATCHED_API_TEMPLATE || template === LEGACY_API_TEMPLATE
    ? unmatchedLimiter
    : apiLimiter;
  const result = await limiter.check(`ip:${getClientIp(request)}`);
  return result.allowed ? null : tooManyRequests(result.retryAfterMs);
}
