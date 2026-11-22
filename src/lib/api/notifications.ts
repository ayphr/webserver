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

export function createNotificationsApi(client: RequestClient) {
  return {
    async list(query: NotificationListQuery = {}) {
      const params = new URLSearchParams();
      if (query.filter) params.set('filter', query.filter);
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      const search = params.toString();
      return client.requestJson<NotificationListPayload>(
        `/api/notifications${search ? `?${search}` : ''}`,
      );
    },
    async unreadCount() {
      const response = await client.requestJson<NotificationUnreadCountPayload>('/api/notifications/unread-count');
      return response.unreadCount;
    },
    async markRead(id: string) {
      const response = await client.requestJson<{ read: boolean; unreadCount: number }>(
        `/api/notifications/${encodeURIComponent(id)}/read`,
        { method: 'POST' },
      );
      return response.unreadCount;
    },
    async markAllRead() {
      const response = await client.requestJson<{ read: boolean; updated: number; unreadCount: number }>(
        '/api/notifications/read-all',
        { method: 'POST' },
      );
      return response.unreadCount;
    },
    async getPreferences() {
      return client.requestJson<NotificationPreferences>('/api/notifications/preferences');
    },
    async updatePreferences(update: NotificationPreferencesUpdate) {
      return client.requestJson<NotificationPreferences>('/api/notifications/preferences', {
        method: 'PATCH',
        body: update,
      });
    },
    async getPushPublicKey() {
      const response = await client.requestJson<PushPublicKeyPayload>('/api/notifications/push/public-key');
      return response.publicKey;
    },
    async subscribePush(subscription: PushSubscriptionInput) {
      return client.requestJson<{ subscribed: boolean }>('/api/notifications/push/subscribe', {
        method: 'POST',
        body: subscription,
      });
    },
    async unsubscribePush() {
      return client.requestJson<{ unsubscribed: boolean }>('/api/notifications/push/subscribe', {
        method: 'DELETE',
      });
    },
    async sendTestPush() {
      return client.requestJson<{ sent: boolean }>('/api/notifications/push/test', {
        method: 'POST',
      });
    },
  };
}
