import { getCollection, trackMongoOperation, normalizeDateValues, INTEGRATIONS_COLLECTION } from './internal';
import type { Integration } from '@common';

export async function getIntegrationsForTeamId(teamId: string): Promise<Integration[]> {
  const integrations = await getCollection(INTEGRATIONS_COLLECTION);
  trackMongoOperation('find', INTEGRATIONS_COLLECTION);
  return integrations.find({ teamId }).sort({ createdAt: -1 }).toArray();
}

export async function getIntegrationById(id: string): Promise<Integration | null> {
  const integrations = await getCollection(INTEGRATIONS_COLLECTION);
  trackMongoOperation('findOne', INTEGRATIONS_COLLECTION);
  return integrations.findOne({ id });
}

export async function createIntegration(integration: Integration): Promise<Integration> {
  const integrations = await getCollection(INTEGRATIONS_COLLECTION);
  const normalized = normalizeDateValues(integration);
  trackMongoOperation('insertOne', INTEGRATIONS_COLLECTION);
  await integrations.insertOne(normalized);
  return normalized;
}

export async function updateIntegration(id: string, updates: Partial<Integration>): Promise<Integration | null> {
  const integrations = await getCollection(INTEGRATIONS_COLLECTION);
  trackMongoOperation('findOneAndUpdate', INTEGRATIONS_COLLECTION);
  const result = await integrations.findOneAndUpdate(
    { id },
    { $set: normalizeDateValues({ ...updates, updatedAt: new Date() }) },
    { returnDocument: 'after' },
  );
  return result;
}

export async function deleteIntegration(id: string, teamId: string): Promise<boolean> {
  const integrations = await getCollection(INTEGRATIONS_COLLECTION);
  trackMongoOperation('deleteOne', INTEGRATIONS_COLLECTION);
  const result = await integrations.deleteOne({ id, teamId });
  return result.deletedCount > 0;
}