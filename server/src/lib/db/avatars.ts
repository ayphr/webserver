import { Binary } from 'mongodb';

import {
  getCollection,
  trackMongoOperation,
  AVATARS_COLLECTION
} from './internal';

export type AvatarMetadata = {
  contentType: string;
  size: number;
  updatedAt: Date;
};


export async function putAvatar(userUuid: string, data: Uint8Array, contentType: string): Promise<AvatarMetadata> {
  const avatars = await getCollection('avatars');
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const metadata: AvatarMetadata = {
    contentType,
    size: bytes.byteLength,
    updatedAt: new Date(),
  };

  trackMongoOperation('updateOne', AVATARS_COLLECTION);
  await avatars.updateOne(
    { userUuid },
    { $set: { ...metadata, userUuid, data: new Binary(bytes) } },
    { upsert: true }
  );

  return metadata;
}


export async function getAvatar(userUuid: string) {
  const avatars = await getCollection('avatars');
  trackMongoOperation('findOne', AVATARS_COLLECTION);
  return avatars.findOne({ userUuid });
}


export async function deleteAvatar(userUuid: string) {
  const avatars = await getCollection('avatars');
  trackMongoOperation('deleteOne', AVATARS_COLLECTION);
  await avatars.deleteOne({ userUuid });
}


