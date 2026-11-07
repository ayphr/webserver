import { randomUUID } from 'node:crypto';
import { getCollection, normalizeDateValues, trackMongoOperation, type DeviceShare } from './internal';

export async function getDeviceShare(serial: number, ownerUuid: string) {
  const shares = await getCollection('deviceShares');
  trackMongoOperation('findOne', 'device_shares');
  return shares.findOne({ serial, ownerUuid }, { projection: { _id: 0 } });
}

export async function upsertDeviceShare(
  serial: number,
  ownerUuid: string,
  input: Pick<DeviceShare, 'access' | 'invitedUsernames'>,
) {
  const shares = await getCollection('deviceShares');
  const now = new Date();
  const existing = await shares.findOne({ serial, ownerUuid });
  const share: DeviceShare = {
    token: existing?.token ?? randomUUID(),
    serial,
    ownerUuid,
    access: input.access,
    invitedUsernames: input.invitedUsernames,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  trackMongoOperation('replaceOne', 'device_shares');
  await shares.replaceOne({ serial, ownerUuid }, normalizeDateValues(share), { upsert: true });
  return share;
}
