import { sessionsTotal } from '../metrics';
import {
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
  SESSIONS_COLLECTION
} from './internal';

import type {
  Session} from '@common';
import { invalidateAuthEntries } from '../authCache';

export async function createSession(session: Session) {
  const sessions = await getCollection('sessions');
  const normalizedSession = normalizeDateValues(session);
  trackMongoOperation('insertOne', SESSIONS_COLLECTION);
  await sessions.insertOne(normalizedSession);
  return normalizedSession;
}


export async function getSessionByTokenHash(tokenHash: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ tokenHash });
}


export async function getSessionById(id: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ id } as Record<string, unknown>);
}


export async function getSessionsForUserUuid(userUuid: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('find', SESSIONS_COLLECTION);
  return sessions.find({ userUuid }).sort({ lastActive: -1 }).toArray();
}


export async function updateSessionLastActive(id: string, when: Date) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('updateOne', SESSIONS_COLLECTION);
  await sessions.updateOne({ id } as Record<string, unknown>, { $set: { lastActive: when } });
}


export async function deleteSession(id: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ id } as Record<string, unknown>);
  sessionsTotal.inc({ event: 'revoked' });
  await invalidateAuthEntries();
}


export async function deleteSessionByTokenHash(tokenHash: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ tokenHash });
  sessionsTotal.inc({ event: 'logout' });
  await invalidateAuthEntries();
}


export async function deleteSessionsForUserUuid(userUuid: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('deleteMany', SESSIONS_COLLECTION);
  const result = await sessions.deleteMany({ userUuid });
  sessionsTotal.inc({ event: 'revoked_all' }, result.deletedCount);
  await invalidateAuthEntries();
}

export async function deleteOtherSessionsForUserUuid(userUuid: string, keepTokenHash: string) {
  const sessions = await getCollection('sessions');
  trackMongoOperation('deleteMany', SESSIONS_COLLECTION);
  const result = await sessions.deleteMany({ userUuid, tokenHash: { $ne: keepTokenHash } });
  sessionsTotal.inc({ event: 'revoked_others' }, result.deletedCount);
  await invalidateAuthEntries();
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------


