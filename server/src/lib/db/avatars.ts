/* eslint-disable @typescript-eslint/no-unused-vars */

import { Binary } from 'mongodb';
import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  getCols,
  trackMongoOperation,
  AVATARS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export type AvatarMetadata = {
  contentType: string;
  size: number;
  updatedAt: Date;
};


export async function putAvatar(userUuid: string, data: Uint8Array, contentType: string): Promise<AvatarMetadata> {
  const { avatars } = await getCols();
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
  const { avatars } = await getCols();
  trackMongoOperation('findOne', AVATARS_COLLECTION);
  return avatars.findOne({ userUuid });
}


export async function deleteAvatar(userUuid: string) {
  const { avatars } = await getCols();
  trackMongoOperation('deleteOne', AVATARS_COLLECTION);
  await avatars.deleteOne({ userUuid });
}


