/* eslint-disable @typescript-eslint/no-unused-vars */

import { sessionsTotal } from '../metrics';
import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  getCols,
  normalizeDateValues,
  trackMongoOperation,
  SESSIONS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function createSession(session: Session) {
  const { sessions } = await getCols();
  const normalizedSession = normalizeDateValues(session);
  trackMongoOperation('insertOne', SESSIONS_COLLECTION);
  await sessions.insertOne(normalizedSession);
  return normalizedSession;
}


export async function getSessionByTokenHash(tokenHash: string) {
  const { sessions } = await getCols();
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ tokenHash });
}


export async function getSessionById(id: string) {
  const { sessions } = await getCols();
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ id } as Record<string, unknown>);
}


export async function getSessionsForUserUuid(userUuid: string) {
  const { sessions } = await getCols();
  trackMongoOperation('find', SESSIONS_COLLECTION);
  return sessions.find({ userUuid }).sort({ lastActive: -1 }).toArray();
}


export async function updateSessionLastActive(id: string, when: Date) {
  const { sessions } = await getCols();
  trackMongoOperation('updateOne', SESSIONS_COLLECTION);
  await sessions.updateOne({ id } as Record<string, unknown>, { $set: { lastActive: when } });
}


export async function deleteSession(id: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ id } as Record<string, unknown>);
  sessionsTotal.inc({ event: 'revoked' });
  await invalidateAuthEntries();
}


export async function deleteSessionByTokenHash(tokenHash: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ tokenHash });
  sessionsTotal.inc({ event: 'logout' });
  await invalidateAuthEntries();
}


export async function deleteSessionsForUserUuid(userUuid: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteMany', SESSIONS_COLLECTION);
  const result = await sessions.deleteMany({ userUuid });
  sessionsTotal.inc({ event: 'revoked_all' }, result.deletedCount);
  await invalidateAuthEntries();
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------


