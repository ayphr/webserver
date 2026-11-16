import {
  getCollection,
  trackMongoOperation,
  LOCATIONS_COLLECTION,
  DEVICES_COLLECTION,
  normalizeDateValues,
} from './internal';

import type { Location } from '@common';

export async function createLocation(location: Location): Promise<Location> {
  const locations = await getCollection('locations');
  const normalized = normalizeDateValues(location);
  trackMongoOperation('insertOne', LOCATIONS_COLLECTION);
  await locations.insertOne(normalized);
  return normalized;
}

export async function getLocationById(id: string): Promise<Location | null> {
  const locations = await getCollection('locations');
  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  return locations.findOne({ id });
}

export async function getLocationsForTeamId(teamId: string): Promise<Location[]> {
  const locations = await getCollection('locations');
  trackMongoOperation('find', LOCATIONS_COLLECTION);
  return locations.find({ teamId }).sort({ createdAt: 1 }).toArray();
}

export async function ensureDefaultLocation(teamId: string, ownerUsername: string): Promise<Location> {
  const locations = await getCollection('locations');

  trackMongoOperation('find', LOCATIONS_COLLECTION);
  const defaults = await locations
    .find({ teamId, isDefault: true })
    .sort({ createdAt: 1 })
    .toArray();
  if (defaults.length > 1) {
    const keeper = defaults[0]!;
    trackMongoOperation('updateMany', LOCATIONS_COLLECTION);
    await locations.updateMany(
      { teamId, isDefault: true, id: { $ne: keeper.id } },
      { $set: { isDefault: false } },
    );
  }

  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const existing = await locations.findOne({ teamId, isDefault: true });
  if (existing) {
    await migrateUnlocatedDevices(teamId, existing.id);
    return existing;
  }

  const all = await locations.find({ teamId }).sort({ createdAt: 1 }).toArray();
  if (all.length > 0) {
    const fallback = all[0]!;
    trackMongoOperation('updateOne', LOCATIONS_COLLECTION);
    await locations.updateOne({ id: fallback.id }, { $set: { isDefault: true } });
    fallback.isDefault = true;
    await migrateUnlocatedDevices(teamId, fallback.id);
    return fallback;
  }

  const location: Location = {
    id: crypto.randomUUID(),
    teamId,
    ownerUsername,
    name: 'Default Location',
    isDefault: true,
    createdAt: new Date(),
  };
  const normalized = normalizeDateValues(location);

  try {
    trackMongoOperation('insertOne', LOCATIONS_COLLECTION);
    await locations.insertOne(normalized);
  } catch (error) {
    const concurrent = await locations.findOne({ teamId, isDefault: true });
    if (concurrent) {
      await migrateUnlocatedDevices(teamId, concurrent.id);
      return concurrent;
    }
    throw error;
  }

  await migrateUnlocatedDevices(teamId, location.id);
  return normalized;
}

async function migrateUnlocatedDevices(teamId: string, locationId: string): Promise<void> {
  const devices = await getCollection('devices');
  trackMongoOperation('updateMany', DEVICES_COLLECTION);
  await devices.updateMany(
    { teamId, $or: [{ locationId: { $exists: false } }, { locationId: { $eq: null } }] } as Record<string, unknown>,
    { $set: { locationId } },
  );
}

export async function updateLocation(id: string, updates: Partial<Pick<Location, 'name'>>): Promise<Location | null> {
  const locations = await getCollection('locations');
  trackMongoOperation('findOneAndUpdate', LOCATIONS_COLLECTION);
  const result = await locations.findOneAndUpdate(
    { id },
    { $set: updates },
    { returnDocument: 'after' },
  );
  return result;
}

export async function deleteLocation(id: string, teamId: string): Promise<boolean> {
  const locations = await getCollection('locations');
  const devices = await getCollection('devices');
  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const location = await locations.findOne({ id, teamId });
  if (!location || location.isDefault) return false;

  trackMongoOperation('findOne', LOCATIONS_COLLECTION);
  const defaultLocation = await locations.findOne({ teamId, isDefault: true });
  if (defaultLocation) {
    trackMongoOperation('updateMany', DEVICES_COLLECTION);
    await devices.updateMany({ teamId, locationId: id }, { $set: { locationId: defaultLocation.id } });
  }

  trackMongoOperation('deleteOne', LOCATIONS_COLLECTION);
  const result = await locations.deleteOne({ id, teamId });
  return result.deletedCount > 0;
}

export async function countLocations(teamId: string): Promise<number> {
  const locations = await getCollection('locations');
  trackMongoOperation('countDocuments', LOCATIONS_COLLECTION);
  return locations.countDocuments({ teamId });
}
