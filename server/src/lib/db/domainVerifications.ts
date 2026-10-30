import * as internal from './internal';
const { getCols, trackMongoOperation, DOMAIN_VERIFICATIONS_COLLECTION } = internal;

import type { DomainVerification } from './internal';

const COLLECTION = DOMAIN_VERIFICATIONS_COLLECTION;

export async function createDomainVerification(verification: DomainVerification) {
  const { domainVerifications } = await internal.getCols();
  const normalized = internal.normalizeDateValues(verification);
  trackMongoOperation('insertOne', COLLECTION);
  await domainVerifications.insertOne(normalized);
  return normalized;
}

export async function getDomainVerificationById(id: string) {
  const { domainVerifications } = await internal.getCols();
  trackMongoOperation('findOne', COLLECTION);
  return domainVerifications.findOne({ id }, { projection: { _id: 0 } });
}

export async function getLatestDomainVerification(userUuid: string, socialType: string, domain: string) {
  const { domainVerifications } = await internal.getCols();
  trackMongoOperation('find', COLLECTION);
  return domainVerifications
    .find({ userUuid, socialType, domain })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();
}

export async function markDomainVerificationVerified(id: string) {
  const { domainVerifications } = await internal.getCols();
  trackMongoOperation('updateOne', COLLECTION);
  await domainVerifications.updateOne({ id }, { $set: { verifiedAt: new Date() } });
}

export async function deleteDomainVerificationsForUser(userUuid: string) {
  const { domainVerifications } = await internal.getCols();
  trackMongoOperation('deleteMany', COLLECTION);
  await domainVerifications.deleteMany({ userUuid });
}