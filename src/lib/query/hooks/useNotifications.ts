import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { queryKeys } from '../keys';

export function useNotificationsUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notificationsUnread(),
    queryFn: () => api.notifications.unreadCount(),
  });
}
