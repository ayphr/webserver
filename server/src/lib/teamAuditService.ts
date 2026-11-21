import { randomUUID } from 'node:crypto';
import type { TeamAuditLog } from '@common';
import { getCollection, normalizeDateValues, trackMongoOperation, TEAM_AUDIT_LOGS_COLLECTION } from './db/internal';

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
  trackMongoOperation('find', TEAM_AUDIT_LOGS_COLLECTION);
  return logs.find({ teamId }).sort({ createdAt: -1 }).limit(limit).toArray();
}
