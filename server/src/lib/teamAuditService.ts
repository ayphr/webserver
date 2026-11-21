import { randomUUID } from 'node:crypto';
import type { TeamAuditLog } from '@common';
import {
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
  TEAM_AUDIT_LOGS_COLLECTION,
  TEAM_AUDIT_LOG_MAX_AGE_SECONDS,
} from './db/internal';

export async function logTeamAudit(entry: Omit<TeamAuditLog, 'id' | 'createdAt'>): Promise<TeamAuditLog> {
  const auditLog: TeamAuditLog = {
    id: randomUUID(),
    createdAt: new Date(),
    ...entry,
  };
  const logs = await getCollection('teamAuditLogs');
  trackMongoOperation('insertOne', TEAM_AUDIT_LOGS_COLLECTION);
  await logs.insertOne(normalizeDateValues(auditLog));
  return auditLog;
}

export async function getTeamAuditLogs(teamId: string, limit = 100): Promise<TeamAuditLog[]> {
  const logs = await getCollection('teamAuditLogs');
  // TTL deletion is asynchronous, so also exclude expired documents from reads.
  const cutoff = new Date(Date.now() - TEAM_AUDIT_LOG_MAX_AGE_SECONDS * 1000);
  trackMongoOperation('find', TEAM_AUDIT_LOGS_COLLECTION);
  return logs.find({ teamId, createdAt: { $gte: cutoff } }).sort({ createdAt: -1 }).limit(limit).toArray();
}
