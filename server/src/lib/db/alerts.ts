import { getCollection, trackMongoOperation, normalizeDateValues, ALERTS_COLLECTION } from './internal';
import type { DeviceAlert } from '@common';

export async function getAlertsForSerial(serial: number, teamId: string): Promise<DeviceAlert[]> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('find', ALERTS_COLLECTION);
  return alerts.find({ serial, teamId }).sort({ createdAt: -1 }).toArray();
}

export async function getAlertById(id: string): Promise<DeviceAlert | null> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('findOne', ALERTS_COLLECTION);
  return alerts.findOne({ id });
}

export async function createAlert(alert: DeviceAlert): Promise<DeviceAlert> {
  const alerts = await getCollection('alerts');
  const normalized = normalizeDateValues(alert);
  trackMongoOperation('insertOne', ALERTS_COLLECTION);
  await alerts.insertOne(normalized);
  return normalized;
}

export async function updateAlert(id: string, updates: Partial<DeviceAlert>): Promise<DeviceAlert | null> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('findOneAndUpdate', ALERTS_COLLECTION);
  return alerts.findOneAndUpdate(
    { id },
    { $set: normalizeDateValues({ ...updates, updatedAt: new Date() }) },
    { returnDocument: 'after' },
  );
}

export async function deleteAlert(id: string, teamId: string): Promise<boolean> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('deleteOne', ALERTS_COLLECTION);
  const result = await alerts.deleteOne({ id, teamId });
  return result.deletedCount > 0;
}

export async function deleteAlertsForSerial(serial: number, teamId: string): Promise<number> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('deleteMany', ALERTS_COLLECTION);
  const result = await alerts.deleteMany({ serial, teamId });
  return result.deletedCount;
}

export async function deleteAlertsForTeamId(teamId: string): Promise<number> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('deleteMany', ALERTS_COLLECTION);
  const result = await alerts.deleteMany({ teamId });
  return result.deletedCount;
}

/** Removes a deleted integration from every alert that targeted it. */
export async function removeIntegrationFromAlerts(teamId: string, integrationId: string): Promise<void> {
  const alerts = await getCollection('alerts');
  trackMongoOperation('updateMany', ALERTS_COLLECTION);
  await alerts.updateMany(
    { teamId, integrationIds: integrationId },
    { $pull: { integrationIds: integrationId }, $set: { updatedAt: new Date() } },
  );
}
