import { Storage } from '@google-cloud/storage';
import { createLogger } from './logger';
import { GCS_BUCKET, GCS_PROJECT_ID, GCS_PUBLIC_BASE_URL } from '../env';

const log = createLogger('storage');

/**
 * Generic object storage service.
 *
 * Backed by Google Cloud Storage but exposed through a small provider-agnostic
 * surface so it can be reused for any uploaded file (avatars, exports, etc.)
 * and swapped for another provider later without touching call sites.
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

function getBucket() {
  if (!client) {
    client = new Storage(GCS_PROJECT_ID ? { projectId: GCS_PROJECT_ID } : {});
  }
  return client.bucket(GCS_BUCKET);
}

function toBuffer(data: Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export async function putObject(
  key: string,
  data: Uint8Array | ArrayBuffer,
  options: PutObjectOptions = {},
): Promise<void> {
  if (!isStorageConfigured()) {
    throw new Error('Object storage is not configured (GCS_BUCKET is unset)');
  }

  await getBucket().file(key).save(toBuffer(data), {
    contentType: options.contentType,
    resumable: false,
    metadata: {
      cacheControl: options.cacheControl,
      metadata: options.metadata,
    },
  });
}

export async function deleteObject(key: string): Promise<void> {
  if (!isStorageConfigured()) return;

  try {
    await getBucket().file(key).delete({ ignoreNotFound: true });
  } catch (error) {
    log.warn({ error, key }, 'failed to delete object');
  }
}

export async function getObject(key: string): Promise<StoredObject | null> {
  if (!isStorageConfigured()) return null;

  const file = getBucket().file(key);

  try {
    const [exists] = await file.exists();
    if (!exists) return null;

    const [data] = await file.download();
    const [metadata] = await file.getMetadata();

    return {
      data,
      contentType: typeof metadata.contentType === 'string' ? metadata.contentType : undefined,
      size: data.byteLength,
      updatedAt: metadata.updated ? new Date(metadata.updated) : undefined,
      etag: typeof metadata.etag === 'string' ? metadata.etag : undefined,
    };
  } catch (error) {
    log.warn({ error, key }, 'failed to download object');
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (!isStorageConfigured()) return false;

  try {
    const [exists] = await getBucket().file(key).exists();
    return exists;
  } catch (error) {
    log.warn({ error, key }, 'failed to check object existence');
    return false;
  }
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
