import type { NotificationFilter } from '@common';
import { json, parsePositiveInt } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  countNotificationsForUserUuid,
  getUnreadNotificationCount,
  listNotificationsForUserUuid,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/db';

const guardOptions = { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true };

const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
const MAX_NOTIFICATION_PAGE_SIZE = 100;

const handleList = requireAuth(async (request, user) => {
  const params = new URL(request.url).searchParams;
  const rawFilter = params.get('filter');
  const filter: NotificationFilter = rawFilter === 'all' ? 'all' : 'unread';
  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = Math.min(
    parsePositiveInt(params.get('pageSize'), DEFAULT_NOTIFICATION_PAGE_SIZE),
    MAX_NOTIFICATION_PAGE_SIZE,
  );
  const skip = (page - 1) * pageSize;

  const [notifications, total, unreadCount] = await Promise.all([
    listNotificationsForUserUuid(user.uuid, filter, { skip, limit: pageSize }),
    countNotificationsForUserUuid(user.uuid, filter),
    getUnreadNotificationCount(user.uuid),
  ]);

  return json({
    notifications,
    total,
    unreadCount,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}, guardOptions);

const handleUnreadCount = requireAuth(async (_request, user) => {
  const unreadCount = await getUnreadNotificationCount(user.uuid);
  return json({ unreadCount });
}, guardOptions);

const handleMarkRead = requireAuth(async (_request, user, params) => {
  const id = params.id;
  if (!id) return json({ error: 'notification id is required' }, 400);

  const updated = await markNotificationRead(user.uuid, id);
  if (!updated) return json({ error: 'notification not found' }, 404);

  const unreadCount = await getUnreadNotificationCount(user.uuid);
  return json({ read: true, unreadCount });
}, guardOptions);

const handleMarkAllRead = requireAuth(async (_request, user) => {
  const updated = await markAllNotificationsRead(user.uuid);
  return json({ read: true, updated, unreadCount: 0 });
}, guardOptions);

export { handleList, handleUnreadCount, handleMarkRead, handleMarkAllRead };
