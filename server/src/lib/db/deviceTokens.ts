import { getCollection, normalizeDateValues, trackMongoOperation, DEVICE_TOKENS_COLLECTION } from './internal';
import type { DeviceUploadToken } from '@common';

export async function getDeviceTokensForSerial(serial: number, teamId: string): Promise<DeviceUploadToken[]> {
  const tokens = await getCollection('deviceTokens');
  trackMongoOperation('find', DEVICE_TOKENS_COLLECTION);
  const list = await tokens.find({ serial, teamId }).toArray();
  // Active first, then most recently used, then created.
  return list
    .map((t) => normalizeDateValues(t))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      if (aUsed !== bUsed) return bUsed - aUsed;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

export async function getDeviceTokenByHash(tokenHash: string): Promise<DeviceUploadToken | null> {
  const tokens = await getCollection('deviceTokens');
  trackMongoOperation('findOne', DEVICE_TOKENS_COLLECTION);
  const found = await tokens.findOne({ tokenHash });
  return found ? normalizeDateValues(found) : null;
}

export async function getDeviceTokenById(id: string): Promise<DeviceUploadToken | null> {
  const tokens = await getCollection('deviceTokens');
  trackMongoOperation('findOne', DEVICE_TOKENS_COLLECTION);
  const found = await tokens.findOne({ id } as Record<string, unknown>);
  return found ? normalizeDateValues(found) : null;
}

export async function createDeviceToken(token: DeviceUploadToken): Promise<DeviceUploadToken> {
  const tokens = await getCollection('deviceTokens');
  const normalized = normalizeDateValues(token);
  trackMongoOperation('insertOne', DEVICE_TOKENS_COLLECTION);
  await tokens.insertOne(normalized);
  return normalized;
}

export async function updateDeviceTokenLastUsed(id: string, when: Date, location?: DeviceUploadToken['location'], userAgent?: string) {
  const tokens = await getCollection('deviceTokens');
  const update: Record<string, unknown> = { lastUsedAt: when };
  if (location) update.location = location;
  if (userAgent !== undefined) update.userAgent = userAgent;
  trackMongoOperation('updateOne', DEVICE_TOKENS_COLLECTION);
  await tokens.updateOne({ id } as Record<string, unknown>, { $set: update });
}

export async function revokeDeviceToken(id: string, teamId: string, serial: number): Promise<boolean> {
  const tokens = await getCollection('deviceTokens');
  trackMongoOperation('updateOne', DEVICE_TOKENS_COLLECTION);
  const result = await tokens.updateOne(
    { id, teamId, serial } as Record<string, unknown>,
    { $set: { active: false, revokedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function markDeviceTokensInactive(serial: number, teamId: string, exceptId?: string) {
  const tokens = await getCollection('deviceTokens');
  const filter: Record<string, unknown> = { serial, teamId, active: true };
  if (exceptId) filter.id = { $ne: exceptId };
  trackMongoOperation('updateMany', DEVICE_TOKENS_COLLECTION);
  await tokens.updateMany(filter, { $set: { active: false, revokedAt: new Date() } });
}

export async function deleteDeviceTokensForSerial(serial: number, teamId: string) {
  const tokens = await getCollection('deviceTokens');
  trackMongoOperation('deleteMany', DEVICE_TOKENS_COLLECTION);
  await tokens.deleteMany({ serial, teamId });
}