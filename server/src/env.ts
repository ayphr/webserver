export const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
export const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'ayphr';
export const MONGO_MAX_POOL_SIZE = Number(process.env.MONGO_MAX_POOL_SIZE || 100);

export const REDIS_URL = process.env.REDIS_URL || '';

export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

export const DATA_POINTS_COLLECTION = 'data_points';
export const USERS_COLLECTION = 'users';
export const PUNISHMENTS_COLLECTION = 'punishments';
export const DEVICES_COLLECTION = 'devices';
export const DEVICE_CLAIMS_COLLECTION = 'device_claims';
export const DEVICE_PAIRINGS_COLLECTION = 'device_pairings';
export const SESSIONS_COLLECTION = 'sessions';
export const STRIPE_EVENTS_COLLECTION = 'stripe_events';
export const AVATARS_COLLECTION = 'avatars';
export const APPS_COLLECTION = 'apps';
export const OAUTH_CODES_COLLECTION = 'oauth_codes';
export const OAUTH_TOKENS_COLLECTION = 'oauth_tokens';
export const CONNECTIONS_COLLECTION = 'connections';
export const DOMAIN_VERIFICATIONS_COLLECTION = 'domain_verifications';
export const LOCATIONS_COLLECTION = 'locations';

export const API_PORT = Number(process.env.API_PORT || 7233);
export const METRICS_PORT = Number(process.env.METRICS_PORT || 7234);

export const DEVICE_TOKEN_TTL_MINUTES = Number(process.env.DEVICE_TOKEN_TTL_MINUTES || 60);
export const DEVICE_TOKEN_TTL_MS = DEVICE_TOKEN_TTL_MINUTES * 60 * 1000;

export const PAIRING_CODE_TTL_MINUTES = Number(process.env.PAIRING_CODE_TTL_MINUTES || 5);
export const PAIRING_CODE_TTL_MS = PAIRING_CODE_TTL_MINUTES * 60 * 1000;

export const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://ayphr.com,https://www.ayphr.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export const STRIPE_TRIAL_DAYS = Number(process.env.STRIPE_TRIAL_DAYS || 7);

export const CLIENT_URL = (process.env.CLIENT_URL || 'https://ayphr.com').replace(/\/+$/, '');

export const STRIPE_PRICE_TIERS: Record<string, { tier: string; interval: string }> = Object.fromEntries(
  (process.env.STRIPE_PRICE_TIERS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [priceId = '', tier = '', interval = 'month'] = entry.split(':').map((part) => part.trim());
      return [priceId, { tier, interval }] as const;
    })
    .filter(([priceId, config]) => Boolean(priceId) && Boolean(config.tier)),
);
