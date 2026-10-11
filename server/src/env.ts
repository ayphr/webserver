export const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
export const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'ayphr';

export const TELEMETRY_COLLECTION = 'telemetry';
export const USERS_COLLECTION = 'users';
export const PUNISHMENTS_COLLECTION = 'punishments';
export const DEVICES_COLLECTION = 'devices';
export const SESSIONS_COLLECTION = 'sessions';
export const STRIPE_EVENTS_COLLECTION = 'stripe_events';

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const REDIS_BUFFER_KEY = process.env.REDIS_BUFFER_KEY || 'ayphr:telemetry:buffer';

export const TCP_PORT = Number(process.env.TCP_PORT || 7232);
export const API_PORT = Number(process.env.API_PORT || 7233);
export const METRICS_PORT = Number(process.env.METRICS_PORT || 7234);

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
