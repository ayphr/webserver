import type {
  NotificationListPayload,
  NotificationUnreadCountPayload,
} from '@common';
import type { RequestClient } from './client';

export function createNotificationsApi(client: RequestClient) {
  return {
    async list(limit = 50) {
      return client.requestJson<NotificationListPayload>(
        `/api/notifications?limit=${encodeURIComponent(String(limit))}`,
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
  };
}
