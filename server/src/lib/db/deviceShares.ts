import { randomUUID } from 'node:crypto';
import { getCollection, normalizeDateValues, trackMongoOperation, type DeviceShare } from './internal';

export async function getDeviceShare(serial: number, ownerUuid: string) {
  const shares = await getCollection('deviceShares');
  trackMongoOperation('findOne', 'device_shares');
  return shares.findOne({ serial, ownerUuid }, { projection: { _id: 0 } });
}

export async function getDeviceShareByToken(token: string) {
  const shares = await getCollection('deviceShares');
  trackMongoOperation('findOne', 'device_shares');
  return shares.findOne({ token }, { projection: { _id: 0 } });
}

export async function deleteDeviceShareBySerial(serial: number) {
  const shares = await getCollection('deviceShares');
  trackMongoOperation('deleteOne', 'device_shares');
  await shares.deleteOne({ serial });
}

export async function deleteDeviceSharesByOwnerUuid(ownerUuid: string) {
  const shares = await getCollection('deviceShares');
  trackMongoOperation('deleteMany', 'device_shares');
  await shares.deleteMany({ ownerUuid });
}

export async function upsertDeviceShare(
  serial: number,
  ownerUuid: string,
  input: Pick<DeviceShare, 'access' | 'invitedUsernames'>,
) {
  const shares = await getCollection('deviceShares');
  const now = new Date();
  const newToken = randomUUID();
  trackMongoOperation('findOneAndUpdate', 'device_shares');
  const updated = await shares.findOneAndUpdate(
    { serial },
    {
      $set: normalizeDateValues({
        ownerUuid,
        access: input.access,
        invitedUsernames: input.invitedUsernames,
        updatedAt: now,
      }),
      $setOnInsert: normalizeDateValues({
        token: newToken,
        serial,
        createdAt: now,
      }),
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (updated) {
    return updated;
  }
  const share = await shares.findOne({ serial, ownerUuid }, { projection: { _id: 0 } });
  if (!share) {
    throw new Error('failed to upsert device share');
  }
  return share;
}
