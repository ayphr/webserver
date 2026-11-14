import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconAlertCircle,
  IconBan,
  IconBell,
  IconCheck,
  IconCreditCard,
  IconInfoCircle,
  IconLogin,
  IconMessage,
  IconShieldLock,
  IconUsersGroup,
} from '@tabler/icons-react';
import type { NotificationType, UserNotification } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { Button } from '../common';
import './NotificationsPanel.css';

type NotificationsPanelProps = {
  onNavigate?: (tab: string) => void;
  onUnreadChange?: (count: number) => void;
};

function getRelativeTime(date: Date | string): string {
  const resolved = toDate(date);
  const diffMs = Date.now() - resolved.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) return resolved.toLocaleDateString('en-GB');
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function NotificationIcon({ type }: Readonly<{ type: NotificationType }>) {
  switch (type) {
    case 'login':
      return <IconLogin size={18} strokeWidth={1.75} />;
    case 'team_invite':
    case 'team':
      return <IconUsersGroup size={18} strokeWidth={1.75} />;
    case 'security':
      return <IconShieldLock size={18} strokeWidth={1.75} />;
    case 'punishment':
      return <IconBan size={18} strokeWidth={1.75} />;
    case 'appeal':
      return <IconMessage size={18} strokeWidth={1.75} />;
    case 'subscription':
      return <IconCreditCard size={18} strokeWidth={1.75} />;
    case 'system':
    default:
      return <IconInfoCircle size={18} strokeWidth={1.75} />;
  }
}

export function NotificationsPanel({ onNavigate, onUnreadChange }: Readonly<NotificationsPanelProps>) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const applyUnreadCount = (count: number) => {
    onUnreadChange?.(count);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await api.notifications.list();
        if (cancelled) return;
        setNotifications(payload.notifications);
        applyUnreadCount(payload.unreadCount);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load notifications');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = async (notification: UserNotification) => {
    if (!notification.read) {
      setPendingId(notification.id);
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, read: true } : item)),
      );
      try {
        const unreadCount = await api.notifications.markRead(notification.id);
        applyUnreadCount(unreadCount);
      } catch {
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, read: false } : item)),
        );
      } finally {
        setPendingId(null);
      }
    }

    if (!notification.link) return;

    const target = new URL(notification.link, globalThis.location.origin);
    const tab = target.searchParams.get('tab');
    if (tab && onNavigate) {
      onNavigate(tab);
    } else {
      navigate(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    setError(null);
    try {
      const unreadCount = await api.notifications.markAllRead();
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      applyUnreadCount(unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark notifications as read');
    } finally {
      setIsMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  if (isLoading) {
    return <p className="notifications-panel__status">Loading notifications...</p>;
  }

  return (
    <div className="notifications-panel">
      <div className="notifications-panel__toolbar">
        <span className="notifications-panel__summary">
          {unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
            : 'You are all caught up'}
        </span>
        <Button
          variant="secondary"
          onClick={() => void handleMarkAllRead()}
          disabled={unreadCount === 0 || isMarkingAll}
          isLoading={isMarkingAll}
        >
          <IconCheck size={16} />
          Mark all as read
        </Button>
      </div>

      {error && (
        <div className="notifications-panel__error">
          <IconAlertCircle size={18} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="notifications-panel__empty">
          <IconBell size={28} strokeWidth={1.5} />
          <p>No notifications yet.</p>
          <span>Account, security, and team updates will appear here.</span>
        </div>
      ) : (
        <ul className="notifications-panel__list">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`notifications-panel__item ${notification.read ? '' : 'notifications-panel__item--unread'}`}
                onClick={() => void handleSelect(notification)}
                disabled={pendingId === notification.id}
              >
                <span className="notifications-panel__icon">
                  <NotificationIcon type={notification.type} />
                </span>
                <span className="notifications-panel__body">
                  <span className="notifications-panel__title">
                    {notification.title}
                    {!notification.read && <span className="notifications-panel__dot" aria-label="Unread" />}
                  </span>
                  <span className="notifications-panel__message">{notification.message}</span>
                  <span className="notifications-panel__time">{getRelativeTime(notification.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
