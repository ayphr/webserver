import type { NotificationFilter, NotificationType, UserNotification } from '@common';
import {
  NOTIFICATIONS_COLLECTION,
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
} from './internal';

export type CreateNotificationInput = {
  userUuid: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
};

export type NotificationListOptions = {
  skip?: number;
  limit?: number;
};

export async function createNotification(input: CreateNotificationInput): Promise<UserNotification> {
  const notification: UserNotification = {
    id: crypto.randomUUID(),
    userUuid: input.userUuid,
    type: input.type,
    title: input.title,
    message: input.message,
    link: input.link,
    read: false,
    createdAt: new Date(),
  };

  const notifications = await getCollection('notifications');
  trackMongoOperation('insertOne', NOTIFICATIONS_COLLECTION);
  await notifications.insertOne(normalizeDateValues(notification));
  return notification;
}

function buildNotificationQuery(userUuid: string, filter: NotificationFilter) {
  return filter === 'unread' ? { userUuid, read: false } : { userUuid };
}

export async function listNotificationsForUserUuid(
  userUuid: string,
  filter: NotificationFilter,
  options: NotificationListOptions = {},
): Promise<UserNotification[]> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('find', NOTIFICATIONS_COLLECTION);
  let cursor = notifications
    .find(buildNotificationQuery(userUuid, filter))
    .project<UserNotification>({ _id: 0 })
    .sort({ createdAt: -1 });
  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);
  return cursor.toArray();
}

export async function countNotificationsForUserUuid(
  userUuid: string,
  filter: NotificationFilter,
): Promise<number> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('countDocuments', NOTIFICATIONS_COLLECTION);
  return notifications.countDocuments(buildNotificationQuery(userUuid, filter));
}

/** Backwards-compatible capped read helper. */
export async function getNotificationsForUserUuid(
  userUuid: string,
  limit = 50,
  filter: NotificationFilter = 'all',
): Promise<UserNotification[]> {
  return listNotificationsForUserUuid(userUuid, filter, { limit });
}

export async function getUnreadNotificationCount(userUuid: string): Promise<number> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('countDocuments', NOTIFICATIONS_COLLECTION);
  return notifications.countDocuments({ userUuid, read: false });
}

export async function markNotificationRead(userUuid: string, id: string): Promise<boolean> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('updateOne', NOTIFICATIONS_COLLECTION);
  const result = await notifications.updateOne(
    { id, userUuid },
    { $set: { read: true, readAt: new Date() } },
  );
  return result.matchedCount > 0;
}

export async function markAllNotificationsRead(userUuid: string): Promise<number> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('updateMany', NOTIFICATIONS_COLLECTION);
  const result = await notifications.updateMany(
    { userUuid, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function deleteNotificationsForUserUuid(userUuid: string): Promise<void> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('deleteMany', NOTIFICATIONS_COLLECTION);
  await notifications.deleteMany({ userUuid });
}
