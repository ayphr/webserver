import type { NotificationType, UserNotification } from '@common';
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

export async function getNotificationsForUserUuid(userUuid: string, limit = 50): Promise<UserNotification[]> {
  const notifications = await getCollection('notifications');
  trackMongoOperation('find', NOTIFICATIONS_COLLECTION);
  return notifications
    .find({ userUuid })
    .project<UserNotification>({ _id: 0 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
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
