import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  getNotificationsForUserUuid,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/db';

const guardOptions = { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true };

const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 100;

const handleList = requireAuth(async (request, user) => {
  const rawLimit = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_NOTIFICATION_LIMIT)
    : DEFAULT_NOTIFICATION_LIMIT;

  const [notifications, unreadCount] = await Promise.all([
    getNotificationsForUserUuid(user.uuid, limit),
    getUnreadNotificationCount(user.uuid),
  ]);

  return json({ notifications, unreadCount });
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
