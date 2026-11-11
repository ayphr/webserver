import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  createLocation,
  deleteLocation,
  ensureDefaultLocation,
  getLocationsForOwnerUuid,
  getLocationById,
  updateLocation,
  countLocations,
} from '../../lib/db';
import { getPlanFeaturesForUser } from '@common';
import { getTeamScopeUuid, getTeamScopeUsername, getTeamForUser, getTeamRole } from '../../lib/db/teams';
import type { Location, User } from '@common';

const MAX_NAME_LENGTH = 64;

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

const handleListMine = requireAuth(async (_request, user: User) => {
  const scopeUuid = await getTeamScopeUuid(user);
  const scopeUsername = await getTeamScopeUsername(user);
  const defaultLocation = await ensureDefaultLocation(scopeUuid, scopeUsername);
  const locations = await getLocationsForOwnerUuid(scopeUuid);
  if (!locations.some((location) => location.id === defaultLocation.id)) {
    locations.unshift(defaultLocation);
  }
  return json({ locations });
});

const handleCreate = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const name = parseName(body?.name);
  if (!name) return json({ error: 'invalid name' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const scopeUsername = await getTeamScopeUsername(user);

  const team = await getTeamForUser(user);
  if (team) {
    const role = getTeamRole(user);
    if (role === 'member') {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  await ensureDefaultLocation(scopeUuid, scopeUsername);

  const maxLocations = getPlanFeaturesForUser(user).maxLocations;
  const currentCount = await countLocations(scopeUuid);
  if (currentCount >= maxLocations) {
    return json({ error: 'location limit reached for your plan' }, 409);
  }

  const location: Location = {
    id: crypto.randomUUID(),
    ownerUuid: scopeUuid,
    ownerUsername: scopeUsername,
    name,
    isDefault: false,
    createdAt: new Date(),
  };

  const created = await createLocation(location);
  return json({ location: created }, 201);
});

const handleGet = requireAuth(async (_request, user: User, params) => {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);

  const location = await getLocationById(id);
  if (!location) return json({ error: 'not found' }, 404);
  if (location.ownerUuid !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return json({ location });
});

const handleUpdate = requireAuth(async (request, user: User, params) => {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);

  const location = await getLocationById(id);
  if (!location) return json({ error: 'not found' }, 404);
  if (location.ownerUuid !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(request);
  const updates: { name?: string } = {};
  if (body?.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return json({ error: 'invalid name' }, 400);
    updates.name = name;
  }

  const updated = await updateLocation(id, updates);
  return json({ location: updated });
});

const handleDelete = requireAuth(async (_request, user: User, params) => {
  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const team = await getTeamForUser(user);

  const location = await getLocationById(id);
  if (!location) return json({ error: 'not found' }, 404);
  if (location.ownerUuid !== scopeUuid) return json({ error: 'forbidden' }, 403);
  if (location.isDefault) return json({ error: 'cannot delete default location' }, 409);

  if (team) {
    const role = getTeamRole(user);
    if (role !== 'manager') {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  const deleted = await deleteLocation(id, scopeUuid);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ deleted: true });
});

export {
  handleListMine as handleLocationsListMine,
  handleCreate as handleLocationCreate,
  handleGet as handleLocationGet,
  handleUpdate as handleLocationUpdate,
  handleDelete as handleLocationDelete,
};