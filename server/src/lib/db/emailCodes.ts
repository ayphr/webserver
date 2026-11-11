import {
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
  EMAIL_CODES_COLLECTION,
} from './internal';

import type { EmailCode, EmailCodePurpose } from './internal';

export async function createEmailCode(code: EmailCode): Promise<EmailCode> {
  const emailCodes = await getCollection('emailCodes');
  const normalized = normalizeDateValues(code);
  trackMongoOperation('insertOne', EMAIL_CODES_COLLECTION);
  await emailCodes.insertOne(normalized);
  return normalized;
}

export async function getEmailCodeForTarget(
  email: string,
  purpose: EmailCodePurpose,
  userUuid?: string,
): Promise<EmailCode | null> {
  const emailCodes = await getCollection('emailCodes');
  trackMongoOperation('findOne', EMAIL_CODES_COLLECTION);
  const query: Record<string, unknown> = { email, purpose };
  query.userUuid = userUuid ? userUuid : { $exists: false };
  return emailCodes.findOne(query, { projection: { _id: 0 }, sort: { createdAt: -1 } });
}

export async function incrementEmailCodeAttempts(codeHash: string): Promise<void> {
  const emailCodes = await getCollection('emailCodes');
  trackMongoOperation('updateOne', EMAIL_CODES_COLLECTION);
  await emailCodes.updateOne({ codeHash }, { $inc: { attempts: 1 } });
}

export async function markEmailCodeUsed(codeHash: string): Promise<boolean> {
  const emailCodes = await getCollection('emailCodes');
  trackMongoOperation('updateOne', EMAIL_CODES_COLLECTION);
  const result = await emailCodes.updateOne(
    { codeHash, used: { $ne: true } },
    { $set: { used: true, usedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

export async function deleteEmailCodesForTarget(
  email: string,
  purpose: EmailCodePurpose,
  userUuid?: string,
): Promise<void> {
  const emailCodes = await getCollection('emailCodes');
  trackMongoOperation('deleteMany', EMAIL_CODES_COLLECTION);
  const query: Record<string, unknown> = { email, purpose };
  query.userUuid = userUuid ? userUuid : { $exists: false };
  await emailCodes.deleteMany(query);
}

export async function deleteEmailCodeByHash(codeHash: string): Promise<void> {
  const emailCodes = await getCollection('emailCodes');
  trackMongoOperation('deleteOne', EMAIL_CODES_COLLECTION);
  await emailCodes.deleteOne({ codeHash });
}