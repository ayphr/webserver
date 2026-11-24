import { BILLING_INTERVALS, SUBSCRIPTION_TIERS } from '@common';
import type { BillingInterval, SubscriptionTier } from '@common';

export type EnvSource = Record<string, string | undefined>;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnvironment = 'development' | 'production' | 'test';

function envNumber(name: string, fallback: number, source: EnvSource = Bun.env): number {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric env ${name}: ${raw}`);
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (!raw) return 'debug';
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;
  throw new Error(`Invalid env LOG_LEVEL: ${raw} (expected ${LOG_LEVELS.join(', ')})`);
}

function parseNodeEnvironment(raw: string | undefined): NodeEnvironment {
  if (!raw) return 'development';
  if (raw === 'development' || raw === 'production' || raw === 'test') return raw;
  throw new Error(`Invalid env NODE_ENV: ${raw} (expected development, production, or test)`);
}

export const NODE_ENV = parseNodeEnvironment(Bun.env.NODE_ENV);
export const LOG_LEVEL = parseLogLevel(Bun.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug'));

export const MONGO_URI = Bun.env.MONGO_URI || 'mongodb://localhost:27017';
export const MONGO_DB_NAME = Bun.env.MONGO_DB_NAME || 'ayphr';
export const MONGO_MAX_POOL_SIZE = envNumber('MONGO_MAX_POOL_SIZE', 100);

export const REDIS_URL = Bun.env.REDIS_URL || '';

export const TRUST_PROXY = Bun.env.TRUST_PROXY === 'true';

export const DATA_POINTS_COLLECTION = 'data_points';
export const USERS_COLLECTION = 'users';
export const EMAIL_CODES_COLLECTION = 'email_codes';
export const PUNISHMENTS_COLLECTION = 'punishments';
export const DEVICES_COLLECTION = 'devices';
export const DEVICE_PAIRINGS_COLLECTION = 'device_pairings';
export const SESSIONS_COLLECTION = 'sessions';
export const STRIPE_EVENTS_COLLECTION = 'stripe_events';
export const AVATARS_COLLECTION = 'avatars';
export const DOMAIN_VERIFICATIONS_COLLECTION = 'domain_verifications';
export const LOCATIONS_COLLECTION = 'locations';
export const INTEGRATIONS_COLLECTION = 'integrations';
export const ALERTS_COLLECTION = 'device_alerts';
export const DEVICE_TOKENS_COLLECTION = 'device_tokens';
export const DEVICE_LOGS_COLLECTION = 'device_logs';
/** Device activity logs are kept for one month; enforced by a MongoDB TTL index. */
export const DEVICE_LOG_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const NOTIFICATIONS_COLLECTION = 'notifications';
export const NOTIFICATION_PREFERENCES_COLLECTION = 'notification_preferences';
export const PUSH_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions';
export const ASSISTANT_STATES_COLLECTION = 'assistant_states';
export const TEAMS_COLLECTION = 'teams';
export const TEAM_INVITES_COLLECTION = 'team_invites';
export const TEAM_AUDIT_LOGS_COLLECTION = 'team_audit_logs';
/** Team audit history is kept for three months; enforced by a MongoDB TTL index. */
export const TEAM_AUDIT_LOG_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';
export const APPEALS_COLLECTION = 'appeals';
export const RATE_LIMITS_COLLECTION = 'rate_limits';

export const API_PORT = envNumber('API_PORT', 7233);
export const METRICS_PORT = envNumber('METRICS_PORT', 7234);

export const PAIRING_CODE_TTL_MINUTES = envNumber('PAIRING_CODE_TTL_MINUTES', 5);
export const PAIRING_CODE_TTL_MS = PAIRING_CODE_TTL_MINUTES * 60 * 1000;

export const CORS_ALLOWED_ORIGINS = (Bun.env.CORS_ALLOWED_ORIGINS || 'https://ayphr.com,https://www.ayphr.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const STRIPE_SECRET_KEY = Bun.env.STRIPE_SECRET_KEY || '';
export const STRIPE_WEBHOOK_SECRET = Bun.env.STRIPE_WEBHOOK_SECRET || '';

export const RESEND_API_KEY = Bun.env.RESEND_API_KEY || '';
export const RESEND_FROM_EMAIL = Bun.env.RESEND_FROM_EMAIL || 'Ayphr <noreply@ayphr.com>';

/** API key used for every Iris response. */
export const GEMINI_API_KEY = Bun.env.GEMINI_API_KEY || '';

/** Web Push VAPID keys. All three are required before subscriptions are accepted. */
export const VAPID_PUBLIC_KEY = Bun.env.VAPID_PUBLIC_KEY || '';
export const VAPID_PRIVATE_KEY = Bun.env.VAPID_PRIVATE_KEY || '';
export const VAPID_SUBJECT = Bun.env.VAPID_SUBJECT || '';

export const EMAIL_CODE_TTL_MINUTES = envNumber('EMAIL_CODE_TTL_MINUTES', 10);
export const EMAIL_CODE_TTL_MS = EMAIL_CODE_TTL_MINUTES * 60 * 1000;

export const STRIPE_TRIAL_DAYS = envNumber('STRIPE_TRIAL_DAYS', 7);

export const CLIENT_URL = (Bun.env.CLIENT_URL || 'https://ayphr.com').replace(/\/+$/, '');

export type StripePriceTierConfig = { tier: SubscriptionTier; interval: BillingInterval };

/** Lenient runtime parser; strict validation happens at startup via validateEnvironment(). */
function parseStripePriceTiers(raw: string | undefined): Record<string, StripePriceTierConfig> {
  return Object.fromEntries(
    (raw || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [priceId = '', tier = '', interval = 'month'] = entry.split(':').map((part) => part.trim());
        return [priceId, { tier, interval }] as const;
      })
      .filter(([priceId, config]) => Boolean(priceId) && Boolean(config.tier)),
  ) as Record<string, StripePriceTierConfig>;
}

export const STRIPE_PRICE_TIERS = parseStripePriceTiers(Bun.env.STRIPE_PRICE_TIERS);

export type EnvironmentValidation = {
  errors: string[];
  warnings: string[];
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validPositiveInteger(value: string | undefined): boolean {
  return value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) > 0;
}

/**
 * Validates configuration without mutating process state. Throwing fields that
 * are parsed at import time are checked here too so startup can report every
 * problem in one pass.
 */
export function validateEnvironment(source: EnvSource = Bun.env): EnvironmentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const checkLogLevel = () => {
    try {
      parseLogLevel(source.LOG_LEVEL);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  const checkNodeEnvironment = () => {
    try {
      parseNodeEnvironment(source.NODE_ENV);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  const checkPort = (name: string, fallback: number) => {
    try {
      const port = envNumber(name, fallback, source);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`Invalid env ${name}: ${source[name]} (expected an integer from 1 to 65535)`);
      }
      return port;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return fallback;
    }
  };
  const checkPositiveInteger = (name: string) => {
    if (source[name] !== undefined && source[name] !== '' && !validPositiveInteger(source[name])) {
      errors.push(`Invalid env ${name}: ${source[name]} (expected a positive integer)`);
    }
  };
  const checkUrl = (name: string, protocols: readonly string[]) => {
    const raw = source[name];
    if (!raw) return;
    try {
      const url = new URL(raw);
      if (!protocols.includes(url.protocol)) {
        errors.push(`Invalid env ${name}: ${raw} (expected ${protocols.join(' or ')} URL)`);
      }
    } catch {
      errors.push(`Invalid env ${name}: ${raw} (expected a valid URL)`);
    }
  };

  checkLogLevel();
  checkNodeEnvironment();

  const apiPort = checkPort('API_PORT', 7233);
  const metricsPort = checkPort('METRICS_PORT', 7234);
  if (apiPort === metricsPort) {
    errors.push('API_PORT and METRICS_PORT must be different');
  }

  for (const name of ['MONGO_MAX_POOL_SIZE', 'PAIRING_CODE_TTL_MINUTES', 'EMAIL_CODE_TTL_MINUTES', 'STRIPE_TRIAL_DAYS']) {
    checkPositiveInteger(name);
  }

  checkUrl('MONGO_URI', ['mongodb:', 'mongodb+srv:']);
  checkUrl('REDIS_URL', ['redis:', 'rediss:']);
  checkUrl('CLIENT_URL', ['http:', 'https:']);

  if (source.TRUST_PROXY !== undefined && source.TRUST_PROXY !== '' && source.TRUST_PROXY !== 'true' && source.TRUST_PROXY !== 'false') {
    errors.push(`Invalid env TRUST_PROXY: ${source.TRUST_PROXY} (expected true or false)`);
  }

  const origins = (source.CORS_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    if (!isHttpUrl(origin)) {
      errors.push(`Invalid env CORS_ALLOWED_ORIGINS entry: ${origin} (expected an absolute http(s) origin)`);
    }
  }

  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = source;
  if ((publicKey || privateKey) && (!publicKey || !privateKey || !subject)) {
    errors.push('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must all be set to enable web push');
  }
  if (subject && !(subject.startsWith('mailto:') || isHttpUrl(subject))) {
    errors.push('Invalid env VAPID_SUBJECT (expected a mailto: address or an https:// URL)');
  }

  const seenPriceIds = new Set<string>();
  for (const entry of (source.STRIPE_PRICE_TIERS || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const parts = entry.split(':').map((part) => part.trim());
    const [priceId, tier, interval = 'month'] = parts;
    if (parts.length < 2 || parts.length > 3 || !priceId || !tier) {
      errors.push(`Invalid env STRIPE_PRICE_TIERS entry: ${entry} (expected price_id:tier[:interval])`);
      continue;
    }
    if (!(SUBSCRIPTION_TIERS as readonly string[]).includes(tier)) {
      errors.push(`Invalid env STRIPE_PRICE_TIERS tier "${tier}" in ${entry} (expected ${SUBSCRIPTION_TIERS.join(', ')})`);
    }
    if (!(BILLING_INTERVALS as readonly string[]).includes(interval)) {
      errors.push(`Invalid env STRIPE_PRICE_TIERS interval "${interval}" in ${entry} (expected ${BILLING_INTERVALS.join(', ')})`);
    }
    if (seenPriceIds.has(priceId)) {
      errors.push(`Duplicate env STRIPE_PRICE_TIERS price ID: ${priceId}`);
    }
    seenPriceIds.add(priceId);
  }

  for (const [name, value] of Object.entries({
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: source.RESEND_API_KEY,
    GEMINI_API_KEY: source.GEMINI_API_KEY,
    REDIS_URL: source.REDIS_URL,
    STRIPE_PRICE_TIERS: source.STRIPE_PRICE_TIERS,
  })) {
    if (!value) warnings.push(`${name} is not set; related features are disabled`);
  }

  return { errors, warnings };
}

export function assertValidEnvironment(source: EnvSource = Bun.env): EnvironmentValidation {
  const result = validateEnvironment(source);
  if (result.errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${result.errors.join('\n- ')}`);
  }
  return result;
}
