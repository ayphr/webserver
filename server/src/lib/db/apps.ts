/* eslint-disable @typescript-eslint/no-unused-vars */

import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  getCols,
  normalizeDateValues,
  trackMongoOperation,
  APPS_COLLECTION,
  CONNECTIONS_COLLECTION,
  OAUTH_CODES_COLLECTION,
  OAUTH_TOKENS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function createApp(app: App): Promise<App> {
  const { apps } = await getCols();
  const normalized = normalizeDateValues(app);
  trackMongoOperation('insertOne', APPS_COLLECTION);
  await apps.insertOne(normalized);
  return normalized;
}


export async function getAppById(id: string): Promise<App | null> {
  const { apps } = await getCols();
  trackMongoOperation('findOne', APPS_COLLECTION);
  return apps.findOne({ id } as Record<string, unknown>, { projection: { _id: 0 } });
}


export async function getAppByClientId(clientId: string): Promise<App | null> {
  const { apps } = await getCols();
  trackMongoOperation('findOne', APPS_COLLECTION);
  return apps.findOne({ clientId }, { projection: { _id: 0 } });
}


export async function getAppsByOwner(ownerUuid: string): Promise<App[]> {
  const { apps } = await getCols();
  trackMongoOperation('find', APPS_COLLECTION);
  return apps.find({ ownerId: ownerUuid }).sort({ createdAt: -1 }).toArray();
}


export async function updateApp(id: string, updates: Partial<App>): Promise<App | null> {
  const { apps } = await getCols();
  const normalized = normalizeDateValues(updates);
  trackMongoOperation('findOneAndUpdate', APPS_COLLECTION);
  const result = await apps.findOneAndUpdate(
    { id } as Record<string, unknown>,
    { $set: normalized },
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  return result;
}


export async function deleteApp(id: string): Promise<void> {
  const { apps, oauthCodes, oauthTokens, connections } = await getCols();
  trackMongoOperation('deleteOne', APPS_COLLECTION);
  await apps.deleteOne({ id } as Record<string, unknown>);
  trackMongoOperation('deleteMany', OAUTH_CODES_COLLECTION);
  await oauthCodes.deleteMany({ appId: id } as Record<string, unknown>);
  trackMongoOperation('deleteMany', OAUTH_TOKENS_COLLECTION);
  await oauthTokens.deleteMany({ appId: id } as Record<string, unknown>);
  trackMongoOperation('deleteMany', CONNECTIONS_COLLECTION);
  await connections.deleteMany({ appId: id } as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// OAuth authorization codes
// ---------------------------------------------------------------------------


