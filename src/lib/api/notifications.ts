import type {
  NotificationListPayload,
  NotificationListQuery,
  NotificationPreferences,
  NotificationPreferencesUpdate,
  NotificationUnreadCountPayload,
  PushPublicKeyPayload,
  PushSubscriptionInput,
} from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createNotificationsApi(client: RequestClient) {
  return {
    async list(query: NotificationListQuery = {}) {
      const params = new URLSearchParams();
      if (query.filter) params.set('filter', query.filter);
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      const search = params.toString();
      return client.requestJson<NotificationListPayload>(
        apiPath(API_PATHS.getNotifications, {}, search ? `?${search}` : ''),
      );
    },
    async unreadCount() {
      const response = await client.requestJson<NotificationUnreadCountPayload>(apiPath(API_PATHS.getNotificationsUnreadCount));
      return response.unreadCount;
    },
    async markRead(id: string) {
      const response = await client.requestJson<{ read: boolean; unreadCount: number }>(
        apiPath(API_PATHS.postNotificationsIdRead, { id: id }),
        { method: 'POST' },
      );
      return response.unreadCount;
    },
    async markAllRead() {
      const response = await client.requestJson<{ read: boolean; updated: number; unreadCount: number }>(
        apiPath(API_PATHS.postNotificationsReadAll),
        { method: 'POST' },
      );
      return response.unreadCount;
    },
    async getPreferences() {
      return client.requestJson<NotificationPreferences>(apiPath(API_PATHS.getNotificationsPreferences));
    },
    async updatePreferences(update: NotificationPreferencesUpdate) {
      return client.requestJson<NotificationPreferences>(apiPath(API_PATHS.patchNotificationsPreferences), {
        method: 'PATCH',
        body: update,
      });
    },
    async getPushPublicKey() {
      const response = await client.requestJson<PushPublicKeyPayload>(apiPath(API_PATHS.getNotificationsPushPublicKey));
      return response.publicKey;
    },
    async subscribePush(subscription: PushSubscriptionInput) {
      return client.requestJson<{ subscribed: boolean }>(apiPath(API_PATHS.postNotificationsPushSubscribe), {
        method: 'POST',
        body: subscription,
      });
    },
    async unsubscribePush() {
      return client.requestJson<{ unsubscribed: boolean }>(apiPath(API_PATHS.deleteNotificationsPushSubscribe), {
        method: 'DELETE',
      });
    },
    async sendTestPush() {
      return client.requestJson<{ sent: boolean }>(apiPath(API_PATHS.postNotificationsPushTest), {
        method: 'POST',
      });
    },
  };
}
