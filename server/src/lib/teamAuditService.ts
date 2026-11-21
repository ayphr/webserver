import { randomUUID } from 'node:crypto';
import type { TeamAuditLog } from '@common';
import {
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
  TEAM_AUDIT_LOGS_COLLECTION,
  TEAM_AUDIT_LOG_MAX_AGE_SECONDS,
} from './db/internal';

export type TeamAuditLogListOptions = {
  skip?: number;
  limit?: number;
};

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

function buildTeamAuditLogQuery(teamId: string) {
  // TTL deletion is asynchronous, so also exclude expired documents from reads.
  const cutoff = new Date(Date.now() - TEAM_AUDIT_LOG_MAX_AGE_SECONDS * 1000);
  return { teamId, createdAt: { $gte: cutoff } };
}

export async function listTeamAuditLogs(
  teamId: string,
  options: TeamAuditLogListOptions = {},
): Promise<TeamAuditLog[]> {
  const logs = await getCollection('teamAuditLogs');
  trackMongoOperation('find', TEAM_AUDIT_LOGS_COLLECTION);
  let cursor = logs
    .find(buildTeamAuditLogQuery(teamId))
    .project<TeamAuditLog>({ _id: 0 })
    .sort({ createdAt: -1 });
  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);
  return cursor.toArray();
}

export async function countTeamAuditLogs(teamId: string): Promise<number> {
  const logs = await getCollection('teamAuditLogs');
  trackMongoOperation('countDocuments', TEAM_AUDIT_LOGS_COLLECTION);
  return logs.countDocuments(buildTeamAuditLogQuery(teamId));
}

/** Backwards-compatible capped read helper. */
export async function getTeamAuditLogs(teamId: string, limit = 100): Promise<TeamAuditLog[]> {
  return listTeamAuditLogs(teamId, { limit });
}
