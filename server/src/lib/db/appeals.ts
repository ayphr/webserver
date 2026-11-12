import { getCollection, normalizeDateValues, trackMongoOperation } from './internal';
import type { Appeal } from '@common';

const APPEALS_COLLECTION = 'appeals';

export async function getAppealById(id: string): Promise<Appeal | null> {
  const appeals = await getCollection('appeals');
  trackMongoOperation('findOne', APPEALS_COLLECTION);
  return appeals.findOne({ id } as Record<string, unknown>);
}

export async function getAppealByPunishmentId(punishmentId: string): Promise<Appeal | null> {
  const appeals = await getCollection('appeals');
  trackMongoOperation('findOne', APPEALS_COLLECTION);
  return appeals.findOne({ punishmentId } as Record<string, unknown>);
}

export async function getAppeals(status?: Appeal['status']): Promise<Appeal[]> {
  const appeals = await getCollection('appeals');
  const query = status ? { status } : {};
  trackMongoOperation('find', APPEALS_COLLECTION);
  return appeals.find(query as Record<string, unknown>).sort({ createdAt: -1 }).toArray();
}

export async function createAppeal(appeal: Appeal): Promise<Appeal> {
  const existing = await getAppealByPunishmentId(appeal.punishmentId);
  if (existing) {
    throw new Error('An appeal has already been submitted for this suspension');
  }
  const appeals = await getCollection('appeals');
  const normalized = normalizeDateValues(appeal);
  trackMongoOperation('insertOne', APPEALS_COLLECTION);
  await appeals.insertOne(normalized);
  return normalized;
}

export async function resolveAppeal(params: {
  appealId: string;
  resolution: 'lifted' | 'denied';
  staffUuid: string;
  staffUsername: string;
}): Promise<Appeal | null> {
  const appeals = await getCollection('appeals');
  trackMongoOperation('findOne', APPEALS_COLLECTION);
  const appeal = await appeals.findOne({ id: params.appealId } as Record<string, unknown>);
  if (!appeal) return null;
  if (appeal.status !== 'pending') return appeal;

  const now = new Date();
  const updated: Appeal = {
    ...appeal,
    status: params.resolution === 'lifted' ? 'accepted' : 'denied',
    resolution: params.resolution,
    resolvedAt: now,
    resolvedByUuid: params.staffUuid,
    resolvedByUsername: params.staffUsername,
  };
  trackMongoOperation('updateOne', APPEALS_COLLECTION);
  await appeals.updateOne(
    { id: params.appealId } as Record<string, unknown>,
    { $set: normalizeDateValues(updated) },
  );
  return updated;
}