import * as internal from './internal';
const {
  getCols,
  trackMongoOperation,
  LOCATIONS_COLLECTION,
  DEVICES_COLLECTION,
} = internal;

import type { Location } from '@common';

export async function createLocation(location: Location): Promise<Location> {
  const { locations } = await getCols();
  const normalized = internal.normalizeDateValues(location);
  trackMongoOperation('insertOne', LOCATIONS_COLLECTION);
  await locations.insertOne(normalized);
  return normalized;
}

export async function getLocationById(id: string): Promise<Location | null> {
  const { locations } = await getCols();
  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  return locations.findOne({ id });
}

export async function getLocationsForOwnerUuid(ownerUuid: string): Promise<Location[]> {
  const { locations } = await getCols();
  trackMongoOperation('find', LOCATIONS_COLLECTION);
  return locations.find({ ownerUuid }).sort({ createdAt: 1 }).toArray();
}

export async function ensureDefaultLocation(ownerUuid: string, ownerUsername: string): Promise<Location> {
  const { locations } = await getCols();

  trackMongoOperation('find', LOCATIONS_COLLECTION);
  const defaults = await locations
    .find({ ownerUuid, isDefault: true })
    .sort({ createdAt: 1 })
    .toArray();
  if (defaults.length > 1) {
    const keeper = defaults[0]!;
    trackMongoOperation('updateMany', LOCATIONS_COLLECTION);
    await locations.updateMany(
      { ownerUuid, isDefault: true, id: { $ne: keeper.id } },
      { $set: { isDefault: false } },
    );
  }

  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const existing = await locations.findOne({ ownerUuid, isDefault: true });
  if (existing) {
    await migrateUnlocatedDevices(ownerUuid, existing.id);
    return existing;
  }

  const all = await locations.find({ ownerUuid }).sort({ createdAt: 1 }).toArray();
  if (all.length > 0) {
    const fallback = all[0]!;
    trackMongoOperation('updateOne', LOCATIONS_COLLECTION);
    await locations.updateOne({ id: fallback.id }, { $set: { isDefault: true } });
    fallback.isDefault = true;
    await migrateUnlocatedDevices(ownerUuid, fallback.id);
    return fallback;
  }

  const location: Location = {
    id: crypto.randomUUID(),
    ownerUuid,
    ownerUsername,
    name: 'Default Location',
    isDefault: true,
    createdAt: new Date(),
  };
  const normalized = internal.normalizeDateValues(location);

  try {
    trackMongoOperation('insertOne', LOCATIONS_COLLECTION);
    await locations.insertOne(normalized);
  } catch (error) {
    const concurrent = await locations.findOne({ ownerUuid, isDefault: true });
    if (concurrent) {
      await migrateUnlocatedDevices(ownerUuid, concurrent.id);
      return concurrent;
    }
    throw error;
  }

  await migrateUnlocatedDevices(ownerUuid, location.id);
  return normalized;
}

async function migrateUnlocatedDevices(ownerUuid: string, locationId: string): Promise<void> {
  const { devices } = await getCols();
  trackMongoOperation('updateMany', DEVICES_COLLECTION);
  await devices.updateMany(
    { ownerUuid, $or: [{ locationId: { $exists: false } }, { locationId: { $eq: null } }] } as Record<string, unknown>,
    { $set: { locationId } },
  );
}

export async function updateLocation(id: string, updates: Partial<Pick<Location, 'name'>>): Promise<Location | null> {
  const { locations } = await getCols();
  trackMongoOperation('findOneAndUpdate', LOCATIONS_COLLECTION);
  const result = await locations.findOneAndUpdate(
    { id },
    { $set: updates },
    { returnDocument: 'after' },
  );
  return result;
}

export async function deleteLocation(id: string, ownerUuid: string): Promise<boolean> {
  const { locations, devices } = await getCols();
  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const location = await locations.findOne({ id, ownerUuid });
  if (!location || location.isDefault) return false;

  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const defaultLocation = await locations.findOne({ ownerUuid, isDefault: true });
  if (defaultLocation) {
    trackMongoOperation('updateMany', DEVICES_COLLECTION);
    await devices.updateMany({ ownerUuid, locationId: id }, { $set: { locationId: defaultLocation.id } });
  }

  trackMongoOperation('deleteOne', LOCATIONS_COLLECTION);
  const result = await locations.deleteOne({ id, ownerUuid });
  return result.deletedCount > 0;
}

export async function countLocations(ownerUuid: string): Promise<number> {
  const { locations } = await getCols();
  trackMongoOperation('countDocuments', LOCATIONS_COLLECTION);
  return locations.countDocuments({ ownerUuid });
}
