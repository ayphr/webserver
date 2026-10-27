/* eslint-disable @typescript-eslint/no-unused-vars */

import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  NONE,
  SUSPENSION_CACHE,
  SUSPENSION_CACHE_TTL_SECONDS,
  getCols,
  normalizeDateValues,
  suspensionCacheKey,
  trackMongoOperation,
  PUNISHMENTS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function deletePunishmentsForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  trackMongoOperation('deleteMany', PUNISHMENTS_COLLECTION);
  await punishments.deleteMany({ userUuid });
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(userUuid));
}


export async function createPunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  trackMongoOperation('insertOne', PUNISHMENTS_COLLECTION);
  await punishments.insertOne(normalizedPunishment);
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(punishment.userUuid));
  return normalizedPunishment;
}


export async function getPunishmentById(id: string) {
  const { punishments } = await getCols();
  trackMongoOperation('findOne', PUNISHMENTS_COLLECTION);
  return punishments.findOne({ id } as Record<string, unknown>);
}


export async function getPunishmentsForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  trackMongoOperation('find', PUNISHMENTS_COLLECTION);
  return punishments.find({ userUuid }).sort({ issuedAt: -1 }).toArray();
}


export async function getActiveSuspensionForUserUuid(userUuid: string) {
  const cacheKey = suspensionCacheKey(userUuid);
  const cached = await cacheGet<Punishment | typeof NONE>(SUSPENSION_CACHE, cacheKey);

  if (cached === NONE) return null;
  if (cached) return cached;

  const { punishments } = await getCols();
  const now = new Date();

  trackMongoOperation('findOne', PUNISHMENTS_COLLECTION);
  const suspension = await punishments.findOne({
    userUuid,
    type: 'suspension',
    liftedAt: { $exists: false },
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }]
  } as Record<string, unknown>);

  // Cache the negative case too: most users are never suspended, and this
  // query previously ran on every single authenticated request.
  await cacheSet(
    SUSPENSION_CACHE,
    cacheKey,
    suspension ?? NONE,
    SUSPENSION_CACHE_TTL_SECONDS,
  );

  return suspension;
}


export async function getPunishmentsByType(type: Punishment['type']) {
  const { punishments } = await getCols();
  trackMongoOperation('find', PUNISHMENTS_COLLECTION);
  return punishments.find({ type }).sort({ issuedAt: -1 }).toArray();
}


export async function updatePunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  trackMongoOperation('updateOne', PUNISHMENTS_COLLECTION);
  await punishments.updateOne(
    { id: punishment.id } as Record<string, unknown>,
    { $set: normalizedPunishment }
  );
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(punishment.userUuid));
  return normalizedPunishment;
}


