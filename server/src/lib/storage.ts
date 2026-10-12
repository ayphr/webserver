import { Storage } from '@google-cloud/storage';
import { createLogger } from './logger';
import { GCS_BUCKET, GCS_CREDENTIALS_JSON, GCS_PROJECT_ID, GCS_PUBLIC_BASE_URL } from '../env';

const log = createLogger('storage');

/**
 * Generic object storage service.
 *
 * Backed by Google Cloud Storage but exposed through a small provider-agnostic
 * surface so it can be reused for any uploaded file (avatars, exports, etc.)
 * and swapped for another provider later without touching call sites.
 *
 * Object transfers use V4 signed URLs (signed locally from the service-account
 * key, no network) combined with the platform fetch API. The @google-cloud/storage
 * client's streaming write path is incompatible with Bun and throws
 * "Cannot call write after a stream was destroyed", so it is only used for
 * offline URL signing here.
 */

export type PutObjectOptions = {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  data: Uint8Array;
  contentType?: string;
  size: number;
  updatedAt?: Date;
  etag?: string;
};

let client: Storage | null = null;

export function isStorageConfigured(): boolean {
  return GCS_BUCKET.length > 0;
}

function resolveCredentials(): Record<string, unknown> | undefined {
  if (!GCS_CREDENTIALS_JSON) return undefined;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(GCS_CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error('GCS_CREDENTIALS_JSON is set but is not valid JSON');
  }

  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('GCS_CREDENTIALS_JSON must contain client_email and private_key');
  }

  return parsed;
}

function getBucket() {
  if (!client) {
    const credentials = resolveCredentials();
    const options: { projectId?: string; credentials?: Record<string, unknown> } = {};
    if (GCS_PROJECT_ID) options.projectId = GCS_PROJECT_ID;
    if (credentials) options.credentials = credentials;
    client = new Storage(options);
  }
  return client.bucket(GCS_BUCKET);
}

function toBuffer(data: Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

async function fileSignedUrl(
  key: string,
  action: 'read' | 'write' | 'delete',
  options: { contentType?: string } = {},
): Promise<string> {
  const [url] = await getBucket().file(key).getSignedUrl({
    action,
    version: 'v4',
    expires: Date.now() + SIGNED_URL_TTL_MS,
    contentType: options.contentType,
  });
  return url;
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.trim().slice(0, 512);
}

export async function putObject(
  key: string,
  data: Uint8Array | ArrayBuffer,
  options: PutObjectOptions = {},
): Promise<void> {
  if (!isStorageConfigured()) {
    throw new Error('Object storage is not configured (GCS_BUCKET is unset)');
  }

  const contentType = options.contentType ?? 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (options.cacheControl) {
    headers['Cache-Control'] = options.cacheControl;
  }

  const url = await fileSignedUrl(key, 'write', { contentType });

  const response = await fetch(url, { method: 'PUT', headers, body: toBuffer(data) });
  if (!response.ok) {
    throw new Error(`Object upload failed (${response.status}): ${await readErrorDetail(response)}`);
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (!isStorageConfigured()) return;

  try {
    const url = await fileSignedUrl(key, 'delete');
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      log.warn(
        { status: response.status, detail: await readErrorDetail(response), key },
        'delete returned an unexpected status',
      );
    }
  } catch (error) {
    log.warn({ error, key }, 'failed to delete object');
  }
}

export async function getObject(key: string): Promise<StoredObject | null> {
  if (!isStorageConfigured()) return null;

  try {
    const url = await fileSignedUrl(key, 'read');
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      log.warn({ status: response.status, detail: await readErrorDetail(response), key }, 'object read failed');
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return {
      data,
      contentType: response.headers.get('Content-Type') ?? undefined,
      size: data.byteLength,
      updatedAt: undefined,
      etag: response.headers.get('ETag') ?? undefined,
    };
  } catch (error) {
    log.warn({ error, key }, 'failed to download object');
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  const object = await getObject(key);
  return object !== null;
}

/**
 * Builds a stable public URL for an object. Only meaningful when the bucket is
 * publicly readable or fronted by a CDN via GCS_PUBLIC_BASE_URL.
 */
export function getPublicObjectUrl(key: string): string | null {
  if (!GCS_BUCKET) return null;

  const base = GCS_PUBLIC_BASE_URL || `https://storage.googleapis.com/${GCS_BUCKET}`;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encodedKey}`;
}

/** Creates a time-limited signed URL for reading a private object. */
export async function getSignedObjectUrl(key: string, expiresInMs = 15 * 60 * 1000): Promise<string | null> {
  if (!isStorageConfigured()) return null;

  const [url] = await getBucket().file(key).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMs,
  });

  return url;
}
