/* eslint-disable @typescript-eslint/no-unused-vars */

import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  getCols,
  normalizeDateValues,
  trackMongoOperation,
  OAUTH_CODES_COLLECTION,
  OAUTH_TOKENS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function createOAuthCode(code: OAuthAuthorizationCode): Promise<OAuthAuthorizationCode> {
  const { oauthCodes } = await getCols();
  const normalized = normalizeDateValues(code);
  trackMongoOperation('insertOne', OAUTH_CODES_COLLECTION);
  await oauthCodes.insertOne(normalized);
  return normalized;
}


export async function getOAuthCodeByHash(codeHash: string): Promise<OAuthAuthorizationCode | null> {
  const { oauthCodes } = await getCols();
  trackMongoOperation('findOne', OAUTH_CODES_COLLECTION);
  return oauthCodes.findOne({ codeHash }, { projection: { _id: 0 } });
}


export async function markOAuthCodeUsed(codeHash: string): Promise<boolean> {
  const { oauthCodes } = await getCols();
  trackMongoOperation('updateOne', OAUTH_CODES_COLLECTION);
  const result = await oauthCodes.updateOne(
    { codeHash, used: { $ne: true } },
    { $set: { used: true, usedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

// ---------------------------------------------------------------------------
// OAuth access tokens
// ---------------------------------------------------------------------------


export async function createOAuthToken(token: OAuthAccessToken): Promise<OAuthAccessToken> {
  const { oauthTokens } = await getCols();
  const normalized = normalizeDateValues(token);
  trackMongoOperation('insertOne', OAUTH_TOKENS_COLLECTION);
  await oauthTokens.insertOne(normalized);
  return normalized;
}


export async function getOAuthTokenByHash(tokenHash: string): Promise<OAuthAccessToken | null> {
  const { oauthTokens } = await getCols();
  trackMongoOperation('findOne', OAUTH_TOKENS_COLLECTION);
  return oauthTokens.findOne({ tokenHash }, { projection: { _id: 0 } });
}


export async function revokeOAuthToken(tokenHash: string): Promise<void> {
  const { oauthTokens } = await getCols();
  trackMongoOperation('updateOne', OAUTH_TOKENS_COLLECTION);
  await oauthTokens.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
}


export async function getOAuthTokensForUser(userId: string): Promise<OAuthAccessToken[]> {
  const { oauthTokens } = await getCols();
  trackMongoOperation('find', OAUTH_TOKENS_COLLECTION);
  return oauthTokens.find({ userId, revokedAt: { $exists: false } } as Record<string, unknown>).toArray();
}


export async function revokeOAuthTokensForConnection(connectionId: string): Promise<void> {
  const { oauthTokens } = await getCols();
  trackMongoOperation('updateMany', OAUTH_TOKENS_COLLECTION);
  await oauthTokens.updateMany({ connectionId } as Record<string, unknown>, { $set: { revokedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------


