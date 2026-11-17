import type { User } from '@common';
import {
  deleteAvatar,
  deleteDevicesForTeamId,
  deleteDomainVerificationsForUser,
  deleteNotificationsForUserUuid,
  deletePunishmentsForUserUuid,
  deleteSessionsForUserUuid,
  deleteUser,
  getCollection,
  getDevicesForTeamId,
} from './db';
import { getTeamForUser } from './db/teams';

export async function deleteUserAccount(user: User): Promise<void> {
  const team = await getTeamForUser(user);
  const scopeId = team && team.managerUuid === user.uuid ? team.id : null;
  const devices = scopeId ? await getDevicesForTeamId(scopeId) : [];
  const deviceSerials = devices.map((device) => device.serial);

  if (deviceSerials.length > 0) {
    const dataPoints = await getCollection('dataPoints');
    await dataPoints.deleteMany({ deviceSerial: { $in: deviceSerials } });
  }

  await Promise.all([
    deletePunishmentsForUserUuid(user.uuid),
    scopeId ? deleteDevicesForTeamId(scopeId) : Promise.resolve(),
    deleteSessionsForUserUuid(user.uuid),
    deleteAvatar(user.uuid),
    deleteDomainVerificationsForUser(user.uuid),
    deleteNotificationsForUserUuid(user.uuid),
  ]);

  if (scopeId) {
    const locations = await getCollection('locations');
    await locations.deleteMany({ teamId: scopeId });
  }

  await deleteUser(user.uuid);
}
