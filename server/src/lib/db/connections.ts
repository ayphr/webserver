/* eslint-disable @typescript-eslint/no-unused-vars */

import { revokeOAuthTokensForConnection } from './oauth';
import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  getCols,
  normalizeDateValues,
  trackMongoOperation,
  CONNECTIONS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function createConnection(connection: Connection): Promise<Connection> {
  const { connections } = await getCols();
  const normalized = normalizeDateValues(connection);
  trackMongoOperation('insertOne', CONNECTIONS_COLLECTION);
  await connections.insertOne(normalized);
  return normalized;
}


export async function getConnectionById(id: string): Promise<Connection | null> {
  const { connections } = await getCols();
  trackMongoOperation('findOne', CONNECTIONS_COLLECTION);
  return connections.findOne({ id } as Record<string, unknown>, { projection: { _id: 0 } });
}


export async function getConnectionsForUser(userId: string): Promise<Connection[]> {
  const { connections } = await getCols();
  trackMongoOperation('find', CONNECTIONS_COLLECTION);
  return connections.find({ userId, revokedAt: { $exists: false } } as Record<string, unknown>).sort({ createdAt: -1 }).toArray();
}


export async function getConnectionByUserAndApp(userId: string, appId: string): Promise<Connection | null> {
  const { connections } = await getCols();
  trackMongoOperation('findOne', CONNECTIONS_COLLECTION);
  return connections.findOne({ userId, appId, revokedAt: { $exists: false } } as Record<string, unknown>, { projection: { _id: 0 } });
}


export async function revokeConnection(id: string, userId: string): Promise<boolean> {
  const { connections } = await getCols();
  trackMongoOperation('updateOne', CONNECTIONS_COLLECTION);
  const result = await connections.updateOne(
    { id, userId } as Record<string, unknown>,
    { $set: { revokedAt: new Date() } },
  );
  if (result.matchedCount > 0) {
    await revokeOAuthTokensForConnection(id);
  }
  return result.matchedCount > 0;
}


export async function updateConnectionScopes(id: string, scopes: string[]): Promise<void> {
  const { connections } = await getCols();
  trackMongoOperation('updateOne', CONNECTIONS_COLLECTION);
  await connections.updateOne({ id } as Record<string, unknown>, { $set: { scopes } });
}

