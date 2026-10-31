/* eslint-disable @typescript-eslint/no-unused-vars */

import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, DevicePairing, StoredAvatar } from './internal';
const {
  DEVICE_CACHE,
  DEVICE_CACHE_TTL_SECONDS,
  DEVICE_LIST_CACHE,
  DEVICE_LIST_CACHE_TTL_SECONDS,
  DEVICE_STATS_CACHE,
  DEVICE_NEGATIVE_TTL_SECONDS,
  NONE,
  client,
  deviceCacheKey,
  deviceListCacheKey,
  deviceStatsCacheKey,
  getCols,
  normalizeDateValues,
  trackMongoOperation,
  DEVICES_COLLECTION,
  DEVICE_CLAIMS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function deleteDevicesForOwnerUuid(ownerUuid: string) {
  const { devices, deviceClaims } = await getCols();

  // Collect serials before deleting so their cache entries can be dropped.
  trackMongoOperation('find', DEVICES_COLLECTION);
  const existing = await devices.find({ ownerUuid }, { projection: { serial: 1, _id: 0 } }).toArray();

  trackMongoOperation('deleteMany', DEVICES_COLLECTION);
  await devices.deleteMany({ ownerUuid });
  trackMongoOperation('deleteOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.deleteOne({ ownerUuid });

  await cacheDel(
    DEVICE_CACHE,
    ...existing.map((device) => deviceCacheKey(device.serial)),
    deviceListCacheKey(ownerUuid),
    deviceStatsCacheKey(ownerUuid),
  );
}


export async function createDevice(device: DeviceDocument) {
  const { devices } = await getCols();
  const normalizedDevice = normalizeDateValues(device);
  trackMongoOperation('insertOne', DEVICES_COLLECTION);
  await devices.insertOne(normalizedDevice);

  await cacheDevice(normalizedDevice);
  // The owner's device list no longer matches.
  await cacheDel(DEVICE_LIST_CACHE, deviceListCacheKey(normalizedDevice.ownerUuid));

  return normalizedDevice;
}

/**
 * Writes a device document into the cache. Used on creation and after uploads so
 * the hot upload path never has to re-read the device from MongoDB.
 */

export async function cacheDevice(device: DeviceDocument): Promise<void> {
  await cacheSet(DEVICE_CACHE, deviceCacheKey(device.serial), device, DEVICE_CACHE_TTL_SECONDS);
}


export async function getDeviceBySerial(serial: number) {
  const cacheKey = deviceCacheKey(serial);
  const cached = await cacheGet<DeviceDocument | typeof NONE>(DEVICE_CACHE, cacheKey);

  if (cached === NONE) return null;
  if (cached) return cached;

  const { devices } = await getCols();
  trackMongoOperation('findOne', DEVICES_COLLECTION);
  const device = await devices.findOne({ serial });

  if (device) {
    await cacheSet(DEVICE_CACHE, cacheKey, device, DEVICE_CACHE_TTL_SECONDS);
  } else {
    // Short negative TTL keeps invalid-serial uploads from hammering MongoDB.
    await cacheSet(DEVICE_CACHE, cacheKey, NONE, DEVICE_NEGATIVE_TTL_SECONDS);
  }

  return device;
}


export async function getDevicesForOwnerUuid(ownerUuid: string) {
  const cacheKey = deviceListCacheKey(ownerUuid);
  const cached = await cacheGet<DeviceDocument[]>(DEVICE_LIST_CACHE, cacheKey);
  if (cached) return cached;

  const { devices } = await getCols();
  trackMongoOperation('find', DEVICES_COLLECTION);
  const list = await devices.find({ ownerUuid }).sort({ registeredAt: -1 }).toArray();

  await cacheSet(DEVICE_LIST_CACHE, cacheKey, list, DEVICE_LIST_CACHE_TTL_SECONDS);

  return list;
}

/** Drops only the per-owner statistics cache (counts / latest point). */
export async function invalidateDeviceStatsForOwner(ownerUuid: string): Promise<void> {
  await cacheDel(DEVICE_STATS_CACHE, deviceStatsCacheKey(ownerUuid));
}

/**
 * Drops the per-owner device list and statistics caches after a device is
 * added, removed, renamed or re-located.
 *
 * Telemetry uploads deliberately do not call this: they happen far more often
 * than the dashboard is read, so invalidating here would keep the keys cold
 * forever. New points reach readers on the next cache fill (bounded by TTL).
 */
export async function invalidateDeviceCachesForOwner(ownerUuid: string): Promise<void> {
  await cacheDel(
    DEVICE_LIST_CACHE,
    deviceListCacheKey(ownerUuid),
    deviceStatsCacheKey(ownerUuid),
  );
}


export async function updateDeviceLastUpload(serial: number, when: Date) {
  const { devices } = await getCols();
  trackMongoOperation('updateOne', DEVICES_COLLECTION);
  await devices.updateOne({ serial }, { $set: { lastUploadAt: when } });
}

export async function updateDeviceToken(serial: number, tokenHash: string, tokenCreatedAt: Date) {
  const { devices } = await getCols();
  trackMongoOperation('updateOne', DEVICES_COLLECTION);
  await devices.updateOne({ serial }, { $set: { tokenHash, tokenCreatedAt } });
  await cacheDel(DEVICE_CACHE, deviceCacheKey(serial));
}

export async function updateDeviceLocation(serial: number, locationId: string) {
  const { devices } = await getCols();
  trackMongoOperation('updateOne', DEVICES_COLLECTION);
  await devices.updateOne({ serial }, { $set: { locationId } });
  await cacheDel(DEVICE_CACHE, deviceCacheKey(serial));
  const device = await devices.findOne({ serial });
  if (device?.ownerUuid) {
    await cacheDel(DEVICE_LIST_CACHE, deviceListCacheKey(device.ownerUuid));
  }
}

/** Strips the secret token fields before a device is returned to a client. */

export function toPublicDevice(device: DeviceDocument): Device {
  const publicDevice: Device & { tokenHash?: string; tokenCreatedAt?: Date } = { ...device };
  delete publicDevice.tokenHash;
  delete publicDevice.tokenCreatedAt;
  return publicDevice;
}


export async function setDeviceClaim(claim: DeviceClaim) {
  const { deviceClaims } = await getCols();
  const normalizedClaim = normalizeDateValues(claim);
  trackMongoOperation('updateOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.updateOne(
    { ownerUuid: claim.ownerUuid },
    { $set: normalizedClaim },
    { upsert: true }
  );
  return normalizedClaim;
}


export async function getDeviceClaimByTokenHash(tokenHash: string) {
  const { deviceClaims } = await getCols();
  trackMongoOperation('findOne', DEVICE_CLAIMS_COLLECTION);
  return deviceClaims.findOne({ tokenHash });
}


export async function deleteDeviceClaim(ownerUuid: string) {
  const { deviceClaims } = await getCols();
  trackMongoOperation('deleteOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.deleteOne({ ownerUuid });
}


export async function createDevicePairing(pairing: DevicePairing) {
  const { devicePairings } = await getCols();
  const normalized = normalizeDateValues(pairing);
  trackMongoOperation('insertOne', 'device_pairings');
  await devicePairings.insertOne(normalized);
  return normalized;
}

export async function getDevicePairingByCode(code: string) {
  const { devicePairings } = await getCols();
  trackMongoOperation('findOne', 'device_pairings');
  return devicePairings.findOne({ code });
}

export async function markDevicePairingLinked(code: string, ownerUuid: string, ownerUsername: string): Promise<boolean> {
  const { devicePairings } = await getCols();
  trackMongoOperation('updateOne', 'device_pairings');
  const result = await devicePairings.updateOne(
    { code, linked: false },
    { $set: { linked: true, ownerUuid, ownerUsername, linkedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function markDevicePairingFetched(code: string) {
  const { devicePairings } = await getCols();
  trackMongoOperation('deleteOne', 'device_pairings');
  await devicePairings.deleteOne({ code });
}
