export const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
export const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'ayphr';

export const TELEMETRY_COLLECTION = 'telemetry';
export const USERS_COLLECTION = 'users';
export const PUNISHMENTS_COLLECTION = 'punishments';
export const DEVICES_COLLECTION = 'devices';

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const REDIS_BUFFER_KEY = process.env.REDIS_BUFFER_KEY || 'ayphr:telemetry:buffer';

export const ENABLE_TLS = process.env.ENABLE_TLS === 'true';
export const CERT_DIR = process.env.CERT_DIR || './certs';
export const CERT_PATH = process.env.CERT_PATH || `${CERT_DIR}/cert.pem`;
export const KEY_PATH = process.env.KEY_PATH || `${CERT_DIR}/key.pem`;
export const ACCOUNT_KEY_PATH = process.env.ACCOUNT_KEY_PATH || `${CERT_DIR}/account.pem`;

export const NETLIFY_AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
export const NETLIFY_ZONE_NAME = process.env.NETLIFY_ZONE_NAME;
export const DOMAIN_NAME = process.env.DOMAIN_NAME;
export const ACME_EMAIL = process.env.ACME_EMAIL;

export const TCP_PORT = Number(process.env.TCP_PORT || 7232);
export const API_PORT = Number(process.env.API_PORT || 7233);
