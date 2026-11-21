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
import type {
  NotificationFilter,
  NotificationListPayload,
  NotificationType,
  UserNotification,
} from '@common';
import { api } from '../../lib/api';
import { getRelativeTime } from '../../lib/date';
import { Button, Pagination } from '../common';
import '../common/Tabs.css';
import './NotificationsPanel.css';

const PAGE_SIZE = 20;

type NotificationsPanelProps = {
  onNavigate?: (tab: string) => void;
  onUnreadChange?: (count: number) => void;
};

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
  const [activeTab, setActiveTab] = useState<NotificationFilter>('unread');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationListPayload>({
    notifications: [],
    total: 0,
    unreadCount: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const applyUnreadCount = (count: number) => {
    setData((current) => ({ ...current, unreadCount: count }));
    onUnreadChange?.(count);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await api.notifications.list({
          filter: activeTab,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        setData(payload);
        onUnreadChange?.(payload.unreadCount);
        if (page > Math.max(1, payload.totalPages)) {
          setPage(Math.max(1, payload.totalPages));
        }
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
  }, [activeTab, page, reloadToken]);

  const handleTabChange = (tab: NotificationFilter) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleSelect = async (notification: UserNotification) => {
    if (!notification.read) {
      const previous = data;
      setPendingId(notification.id);
      setData((current) => {
        const total = activeTab === 'unread' ? Math.max(0, current.total - 1) : current.total;
        return {
          ...current,
          total,
          totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          notifications: activeTab === 'unread'
            ? current.notifications.filter((item) => item.id !== notification.id)
            : current.notifications.map((item) => (
              item.id === notification.id ? { ...item, read: true } : item
            )),
        };
      });
      try {
        const unreadCount = await api.notifications.markRead(notification.id);
        applyUnreadCount(unreadCount);
        setReloadToken((token) => token + 1);
      } catch {
        setData(previous);
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
    const previous = data;
    setIsMarkingAll(true);
    setError(null);
    try {
      const unreadCount = await api.notifications.markAllRead();
      applyUnreadCount(unreadCount);
      setPage(1);
      setData((current) => activeTab === 'unread'
        ? { ...current, notifications: [], total: 0, totalPages: 1 }
        : {
          ...current,
          notifications: current.notifications.map((item) => ({ ...item, read: true })),
        });
      setReloadToken((token) => token + 1);
    } catch (err) {
      setData(previous);
      setError(err instanceof Error ? err.message : 'Failed to mark notifications as read');
    } finally {
      setIsMarkingAll(false);
    }
  };

  if (isLoading) {
    return <p className="notifications-panel__status">Loading notifications...</p>;
  }

  return (
    <div className="notifications-panel">
      <div className="ui-tabs" role="tablist" aria-label="Notification views">
        {(['unread', 'all'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="notifications-panel-list"
            id={`notifications-tab-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`ui-tab ${activeTab === tab ? 'ui-tab--active' : ''}`}
            onClick={() => handleTabChange(tab)}
          >
            {tab === 'unread' ? 'Unread' : 'All'}
          </button>
        ))}
      </div>

      <div className="notifications-panel__toolbar">
        <span className="notifications-panel__summary">
          {data.unreadCount > 0
            ? `${data.unreadCount} unread notification${data.unreadCount === 1 ? '' : 's'}`
            : 'You are all caught up'}
        </span>
        <Button
          variant="secondary"
          onClick={() => void handleMarkAllRead()}
          disabled={data.unreadCount === 0 || isMarkingAll}
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

      <div
        id="notifications-panel-list"
        role="tabpanel"
        aria-labelledby={`notifications-tab-${activeTab}`}
      >
        {data.notifications.length === 0 ? (
          <div className="notifications-panel__empty">
            <IconBell size={28} strokeWidth={1.5} />
            <p>{activeTab === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</p>
            <span>
              {activeTab === 'unread'
                ? 'You are all caught up. New updates will appear here.'
                : 'Account, security, and team updates will appear here.'}
            </span>
          </div>
        ) : (
          <ul className="notifications-panel__list">
            {data.notifications.map((notification) => (
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

      <Pagination
        page={page}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={isLoading || isMarkingAll}
      />
    </div>
  );
}
