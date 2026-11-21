import { Binary, Collection, Db } from 'mongodb';
import { createLogger } from '../logger';
export * from '../../env';
import { recordMongoOperation } from '../metrics';
import { type DataPoint, type Device, type Location, type Punishment, type Session, type User, type Team, type TeamAuditLog, type TeamInvite, type Appeal, type UserNotification, type Integration, type DeviceAlert, type DeviceUploadToken, type AssistantState } from '@common';

import {
  DATA_POINTS_COLLECTION,
  USERS_COLLECTION,
  PUNISHMENTS_COLLECTION,
  DEVICES_COLLECTION,
  DEVICE_PAIRINGS_COLLECTION,
  SESSIONS_COLLECTION,
  STRIPE_EVENTS_COLLECTION,
  AVATARS_COLLECTION,
  DOMAIN_VERIFICATIONS_COLLECTION,
  LOCATIONS_COLLECTION,
  INTEGRATIONS_COLLECTION,
  ALERTS_COLLECTION,
  DEVICE_TOKENS_COLLECTION,
  EMAIL_CODES_COLLECTION,
  NOTIFICATIONS_COLLECTION,
  ASSISTANT_STATES_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_INVITES_COLLECTION,
  TEAM_AUDIT_LOGS_COLLECTION,
  TEAM_AUDIT_LOG_MAX_AGE_SECONDS,
  APPEALS_COLLECTION
} from '../../env';
export * from './serialization';
export * from './cacheKeys';
export {
  client,
  database,
  connectPromise,
  collections,
  connect,
  disconnect,
  getCols,
  getCollection,
} from './mongoLifecycle';

export const log = createLogger('db');

/** A data point as stored, keyed by device serial and timestamp. */
export type DataPointDocument = DataPoint & {
  deviceSerial: number;
};

/** A device as stored, including the secret token hash that is never exposed. */
export type DeviceDocument = Device & {
  tokenHash: string;
  tokenCreatedAt: Date;
};

export type DevicePairing = {
  code: string;
  serial: number;
  name?: string;
  token: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  linked: boolean;
  teamId?: string;
  ownerUsername?: string;
  linkedAt?: Date;
  fetched?: boolean;
};

export type EmailCodePurpose = 'register' | 'reset' | 'change' | 'login';

export type EmailCode = {
  codeHash: string;
  email: string;
  purpose: EmailCodePurpose;
  userUuid?: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  used?: boolean;
};

export type DomainVerification = {
  id: string;
  userUuid: string;
  socialType: string;
  domain: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  verifiedAt?: Date;
};

export interface Collections {
  dataPoints: Collection<DataPointDocument>;
  users: Collection<User>;
  punishments: Collection<Punishment>;
  devices: Collection<DeviceDocument>;
  devicePairings: Collection<DevicePairing>;
  sessions: Collection<Session>;
  stripeEvents: Collection<{ id: string; type: string; createdAt: Date }>;
  avatars: Collection<StoredAvatar>;
  domainVerifications: Collection<DomainVerification>;
  locations: Collection<Location>;
  integrations: Collection<Integration>;
  alerts: Collection<DeviceAlert>;
  deviceTokens: Collection<DeviceUploadToken>;
  emailCodes: Collection<EmailCode>;
  teams: Collection<Team>;
  teamAuditLogs: Collection<TeamAuditLog>;
  teamInvites: Collection<TeamInvite>;
  appeals: Collection<Appeal>;
  notifications: Collection<UserNotification>;
  assistantStates: Collection<AssistantStateDocument>;
}

export type AssistantStateDocument = AssistantState & {
  userUuid: string;
  updatedAt: Date;
};

export interface StoredAvatar {
  userUuid: string;
  contentType: string;
  size: number;
  updatedAt: Date;
  data: Binary;
}

export function trackMongoOperation(operation: string, collection: string) {
  recordMongoOperation(operation, collection);
}

export async function setupCollections(db: Db): Promise<Collections> {
  trackMongoOperation('listCollections', '*');
  const existingCollections = await db.collections();
  const existingNames = new Set(existingCollections.map((c) => c.collectionName));

  if (!existingNames.has(DATA_POINTS_COLLECTION)) {
    try {
      trackMongoOperation('createCollection', DATA_POINTS_COLLECTION);
      await db.createCollection(DATA_POINTS_COLLECTION);
      log.info({ collection: DATA_POINTS_COLLECTION }, 'created data points collection');
    } catch (error) {
      log.warn({ error, collection: DATA_POINTS_COLLECTION }, 'could not create collection');
    }
  }

  const cols: Collections = {
    dataPoints: db.collection<DataPointDocument>(DATA_POINTS_COLLECTION),
    users: db.collection<User>(USERS_COLLECTION),
    punishments: db.collection<Punishment>(PUNISHMENTS_COLLECTION),
    devices: db.collection<DeviceDocument>(DEVICES_COLLECTION),
    devicePairings: db.collection<DevicePairing>(DEVICE_PAIRINGS_COLLECTION),
    sessions: db.collection<Session>(SESSIONS_COLLECTION),
    stripeEvents: db.collection<{ id: string; type: string; createdAt: Date }>(STRIPE_EVENTS_COLLECTION),
    avatars: db.collection<StoredAvatar>(AVATARS_COLLECTION),
    domainVerifications: db.collection<DomainVerification>(DOMAIN_VERIFICATIONS_COLLECTION),
    locations: db.collection<Location>(LOCATIONS_COLLECTION),
    integrations: db.collection<Integration>(INTEGRATIONS_COLLECTION),
    alerts: db.collection<DeviceAlert>(ALERTS_COLLECTION),
    deviceTokens: db.collection<DeviceUploadToken>(DEVICE_TOKENS_COLLECTION),
    emailCodes: db.collection<EmailCode>(EMAIL_CODES_COLLECTION),
    teams: db.collection<Team>(TEAMS_COLLECTION),
    teamAuditLogs: db.collection<TeamAuditLog>(TEAM_AUDIT_LOGS_COLLECTION),
    teamInvites: db.collection<TeamInvite>(TEAM_INVITES_COLLECTION),
    appeals: db.collection<Appeal>(APPEALS_COLLECTION),
    notifications: db.collection<UserNotification>(NOTIFICATIONS_COLLECTION),
    assistantStates: db.collection<AssistantStateDocument>(ASSISTANT_STATES_COLLECTION),
  };

  const indexSpecs: Array<[string, () => Promise<unknown>]> = [
    // One document per device per second; uploads replace the value at that second.
    [DATA_POINTS_COLLECTION, () => cols.dataPoints.createIndex({ deviceSerial: 1, timestamp: 1 }, { unique: true })],
    [DATA_POINTS_COLLECTION, () => cols.dataPoints.createIndex({ timestamp: -1 })],
    [USERS_COLLECTION, () => cols.users.createIndex({ uuid: 1 }, { unique: true })],
    [USERS_COLLECTION, () => cols.users.createIndex({ username: 1 }, { unique: true })],
    // Email is optional, so only string values participate in the uniqueness
    // constraint. Registration relies on this to close the check-then-insert race.
    [USERS_COLLECTION, () => cols.users.createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
    )],
    [USERS_COLLECTION, () => cols.users.createIndex({ createdAt: -1 })],
    [USERS_COLLECTION, () => cols.users.createIndex({ role: 1, createdAt: -1 })],
    [AVATARS_COLLECTION, () => cols.avatars.createIndex({ userUuid: 1 }, { unique: true })],
    [PUNISHMENTS_COLLECTION, () => cols.punishments.createIndex({ userUuid: 1 })],
    [PUNISHMENTS_COLLECTION, () => cols.punishments.createIndex({ userUuid: 1, issuedAt: -1 })],
    [PUNISHMENTS_COLLECTION, () => cols.punishments.createIndex({ userUuid: 1, type: 1, liftedAt: 1, startsAt: 1, endsAt: 1 })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex({ serial: 1 }, { unique: true })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex({ teamId: 1 })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    )],
    [DEVICE_PAIRINGS_COLLECTION, () => cols.devicePairings.createIndex({ code: 1 }, { unique: true })],
    [DEVICE_PAIRINGS_COLLECTION, () => cols.devicePairings.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })],
    [EMAIL_CODES_COLLECTION, () => cols.emailCodes.createIndex({ codeHash: 1 }, { unique: true })],
    [EMAIL_CODES_COLLECTION, () => cols.emailCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })],
    [EMAIL_CODES_COLLECTION, () => cols.emailCodes.createIndex({ email: 1, purpose: 1, userUuid: 1 })],
    [LOCATIONS_COLLECTION, () => cols.locations.createIndex({ id: 1 }, { unique: true })],
    [LOCATIONS_COLLECTION, () => cols.locations.createIndex({ teamId: 1 })],
    [LOCATIONS_COLLECTION, () => cols.locations.createIndex(
      { teamId: 1, isDefault: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } }
    )],
    [STRIPE_EVENTS_COLLECTION, () => cols.stripeEvents.createIndex({ id: 1 }, { unique: true })],
    [STRIPE_EVENTS_COLLECTION, () => cols.stripeEvents.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })],
    [NOTIFICATIONS_COLLECTION, () => cols.notifications.createIndex({ id: 1 }, { unique: true })],
    [NOTIFICATIONS_COLLECTION, () => cols.notifications.createIndex({ userUuid: 1, createdAt: -1 })],
    [NOTIFICATIONS_COLLECTION, () => cols.notifications.createIndex({ userUuid: 1, read: 1 })],
    [NOTIFICATIONS_COLLECTION, () => cols.notifications.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 })],
    [ASSISTANT_STATES_COLLECTION, () => cols.assistantStates.createIndex({ userUuid: 1 }, { unique: true })],
    [ALERTS_COLLECTION, () => cols.alerts.createIndex({ id: 1 }, { unique: true })],
    [ALERTS_COLLECTION, () => cols.alerts.createIndex({ serial: 1, teamId: 1, createdAt: -1 })],
    [ALERTS_COLLECTION, () => cols.alerts.createIndex({ teamId: 1, createdAt: -1 })],
    [DEVICE_TOKENS_COLLECTION, () => cols.deviceTokens.createIndex({ id: 1 }, { unique: true })],
    [DEVICE_TOKENS_COLLECTION, () => cols.deviceTokens.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    )],
    [DEVICE_TOKENS_COLLECTION, () => cols.deviceTokens.createIndex({ serial: 1, teamId: 1 })],
    [DOMAIN_VERIFICATIONS_COLLECTION, () => cols.domainVerifications.createIndex({ id: 1 }, { unique: true })],
    [DOMAIN_VERIFICATIONS_COLLECTION, () => cols.domainVerifications.createIndex(
      { userUuid: 1, socialType: 1, domain: 1, createdAt: -1 }
    )],
    [APPEALS_COLLECTION, () => cols.appeals.createIndex({ id: 1 }, { unique: true })],
    // One appeal per punishment: backs the check in createAppeal.
    [APPEALS_COLLECTION, () => cols.appeals.createIndex({ punishmentId: 1 }, { unique: true })],
    [APPEALS_COLLECTION, () => cols.appeals.createIndex({ status: 1, createdAt: -1 })],
    [INTEGRATIONS_COLLECTION, () => cols.integrations.createIndex({ id: 1 }, { unique: true })],
    [INTEGRATIONS_COLLECTION, () => cols.integrations.createIndex({ teamId: 1, createdAt: -1 })],
    [TEAMS_COLLECTION, () => cols.teams.createIndex({ id: 1 }, { unique: true })],
    [TEAM_INVITES_COLLECTION, () => cols.teamInvites.createIndex({ token: 1 }, { unique: true })],
    [TEAM_INVITES_COLLECTION, () => cols.teamInvites.createIndex({ email: 1 })],
    [TEAM_INVITES_COLLECTION, () => cols.teamInvites.createIndex({ teamId: 1, createdAt: -1 })],
    [TEAM_AUDIT_LOGS_COLLECTION, () => cols.teamAuditLogs.createIndex({ teamId: 1, createdAt: -1 })],
    [TEAM_AUDIT_LOGS_COLLECTION, () => cols.teamAuditLogs.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: TEAM_AUDIT_LOG_MAX_AGE_SECONDS }
    )],
  ];

  await Promise.all(
    indexSpecs.map(async ([collection, createIndex]) => {
      trackMongoOperation('createIndex', collection);
      return createIndex();
    })
  ).catch((error) => log.warn({ error }, 'failed to ensure indexes'));

  try {
    await ensureSessionIndexes(cols.sessions);
  } catch (error) {
    log.warn({ error }, 'failed to ensure sessions indexes');
  }

  try {
    await ensureTeamIndexes(cols.teams);
  } catch (error) {
    log.warn({ error }, 'failed to ensure team indexes');
  }

  return cols;
}

/**
 * Older deployments enforced one team per manager with a unique index. Users
 * can now belong to (and manage) several teams, so the stale unique index is
 * dropped here before the non-unique one is created on startup.
 */
export async function ensureTeamIndexes(teams: Collection<Team>) {
  trackMongoOperation('listIndexes', 'teams');
  const existing = await teams.listIndexes().toArray();

  for (const index of existing) {
    const fields = Object.keys(index.key ?? {});
    if (fields.length === 1 && fields[0] === 'managerUuid' && index.unique) {
      trackMongoOperation('dropIndex', 'teams');
      await teams.dropIndex(index.name);
    }
  }

  trackMongoOperation('createIndex', 'teams');
  await teams.createIndex({ managerUuid: 1 });
  trackMongoOperation('createIndex', 'teams');
  await teams.createIndex({ stripeCustomerId: 1 }, { sparse: true });
}

/**
 * Reconciles the sessions collection indexes with the current schema.
 *
 * Older deployments carried unique indexes on the legacy `token` field (and a
 * non-partial `tokenHash` index) that break inserts after the schema moved to
 * `tokenHash`. Unique indexes treat a missing field as `null`, so multiple
 * documents without the field produce `E11000 duplicate key` errors on build
 * and on write. Those stale indexes are dropped here and rebuilt as a partial
 * unique index so legacy documents (which have no `tokenHash`) are excluded.
 */
export async function ensureSessionIndexes(sessions: Collection<Session>) {
  trackMongoOperation('listIndexes', SESSIONS_COLLECTION);
  const existing = await sessions.listIndexes().toArray();

  const stale: string[] = [];
  for (const index of existing) {
    const fields = Object.keys(index.key ?? {});
    if (fields.length !== 1) continue;

    const [field] = fields;
    if (field === 'token' || (field === 'tokenHash' && !index.partialFilterExpression)) {
      stale.push(index.name);
    }
  }

  for (const name of stale) {
    trackMongoOperation('dropIndex', SESSIONS_COLLECTION);
    await sessions.dropIndex(name);
  }

  const indexSpecs: Array<() => Promise<unknown>> = [
    () => sessions.createIndex({ id: 1 }, { unique: true }),
    () => sessions.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    ),
    () => sessions.createIndex({ userUuid: 1 }),
    () => sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ];

  await Promise.all(
    indexSpecs.map(async (createIndex) => {
      trackMongoOperation('createIndex', SESSIONS_COLLECTION);
      return createIndex();
    })
  );
}
