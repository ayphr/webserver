import { describe, expect, test } from 'bun:test';
import { validateEnvironment } from './env';

describe('validateEnvironment', () => {
  test('accepts defaults', () => {
    const result = validateEnvironment({});
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('rejects invalid enum values and ports', () => {
    const { errors } = validateEnvironment({
      NODE_ENV: 'staging',
      LOG_LEVEL: 'loud',
      API_PORT: '7233',
      METRICS_PORT: '7233',
      TRUST_PROXY: 'yes',
    });
    expect(errors.some((error) => error.includes('NODE_ENV'))).toBe(true);
    expect(errors.some((error) => error.includes('LOG_LEVEL'))).toBe(true);
    expect(errors.some((error) => error.includes('API_PORT'))).toBe(true);
    expect(errors.some((error) => error.includes('must be different'))).toBe(true);
    expect(errors.some((error) => error.includes('TRUST_PROXY'))).toBe(true);
  });

  test('rejects invalid URLs and positive-integer settings', () => {
    const { errors } = validateEnvironment({
      CLIENT_URL: 'ftp://example.com',
      MONGO_URI: 'postgres://example.com',
      REDIS_URL: 'http://example.com',
      CORS_ALLOWED_ORIGINS: 'https://ayphr.com,not-a-url',
      PAIRING_CODE_TTL_MINUTES: '0',
      STRIPE_TRIAL_DAYS: '1.5',
    });
    expect(errors.some((error) => error.includes('CLIENT_URL'))).toBe(true);
    expect(errors.some((error) => error.includes('MONGO_URI'))).toBe(true);
    expect(errors.some((error) => error.includes('REDIS_URL'))).toBe(true);
    expect(errors.some((error) => error.includes('CORS_ALLOWED_ORIGINS'))).toBe(true);
    expect(errors.some((error) => error.includes('PAIRING_CODE_TTL_MINUTES'))).toBe(true);
    expect(errors.some((error) => error.includes('STRIPE_TRIAL_DAYS'))).toBe(true);
  });

  test('validates Stripe price tier entries', () => {
    const { errors } = validateEnvironment({
      STRIPE_PRICE_TIERS: 'price_1:lite:month,price_2:unknown:year,price_1:plus:weekly,bad-entry',
    });
    expect(errors.some((error) => error.includes('unknown'))).toBe(true);
    expect(errors.some((error) => error.includes('weekly'))).toBe(true);
    expect(errors.some((error) => error.includes('Duplicate'))).toBe(true);
    expect(errors.some((error) => error.includes('expected price_id:tier'))).toBe(true);
  });

  test('requires all VAPID values together', () => {
    const { errors } = validateEnvironment({ VAPID_PUBLIC_KEY: 'public-only' });
    expect(errors.some((error) => error.includes('VAPID_PUBLIC_KEY'))).toBe(true);
  });

  test('flags optional integrations as warnings', () => {
    const { warnings } = validateEnvironment({ STRIPE_SECRET_KEY: '' });
    expect(warnings.some((warning) => warning.includes('STRIPE_SECRET_KEY'))).toBe(true);
  });
});
