import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconAlertCircle,
  IconBan,
  IconBell,
  IconBellCog,
  IconCheck,
  IconCloud,
  IconCreditCard,
  IconInfoCircle,
  IconLogin,
  IconMessage,
  IconSend,
  IconShieldLock,
  IconUsersGroup,
} from '@tabler/icons-react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  type NotificationFilter,
  type NotificationListPayload,
  type NotificationPreferences,
  type NotificationType,
  type UserNotification,
} from '@common';
import { api } from '../../lib/api';
import { getRelativeTime } from '../../lib/date';
import {
  disablePush,
  enablePush,
  getPushPermissionState,
  isPushSubscribed,
  isPushSupported,
} from '../../lib/push';
import { Button, Checkbox, Modal, Pagination, Tooltip } from '../common';
import '../common/Tabs.css';
import './NotificationsPanel.css';

const PAGE_SIZE = 20;

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  login: 'Logins',
  team_invite: 'Team invites',
  team: 'Team updates',
  security: 'Security alerts',
  punishment: 'Punishments',
  appeal: 'Appeals',
  subscription: 'Subscriptions & billing',
  assistant_task: 'Iris',
  system: 'System messages',
};

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
    case 'assistant_task':
      return <IconCloud size={18} strokeWidth={1.75} />;
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

  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [isPreferencesLoading, setIsPreferencesLoading] = useState(false);
  const [isPreferencesSaving, setIsPreferencesSaving] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [testPushSent, setTestPushSent] = useState(false);

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

  const openPreferences = () => {
    setIsPreferencesOpen(true);
    setPreferencesError(null);
    setTestPushSent(false);
    setPublicKey(undefined);
    setIsPreferencesLoading(true);
    void (async () => {
      try {
        const [savedPreferences, key, subscribed] = await Promise.all([
          api.notifications.getPreferences(),
          api.notifications.getPushPublicKey(),
          isPushSubscribed(),
        ]);
        setPreferences(savedPreferences);
        setPublicKey(key);
        setPushSubscribed(subscribed);
      } catch (err) {
        setPreferencesError(err instanceof Error ? err.message : 'Failed to load notification preferences');
      } finally {
        setIsPreferencesLoading(false);
      }
    })();
  };

  const pushUnavailableReason = (() => {
    if (publicKey === undefined) return 'Checking browser push availability...';
    if (!isPushSupported()) {
      return 'Browser push needs HTTPS (or localhost) and a browser with Push API support.';
    }
    if (getPushPermissionState() === 'denied') {
      return 'Browser notifications are blocked. Allow them in your browser settings to enable push.';
    }
    if (!publicKey) return 'Browser push is not configured on the server.';
    return null;
  })();

  const handleTogglePush = async (enabled: boolean) => {
    setPreferencesError(null);
    setTestPushSent(false);
    if (!publicKey || pushUnavailableReason) {
      setPreferencesError(pushUnavailableReason ?? 'Browser push is not available.');
      return;
    }

    try {
      if (enabled) {
        await enablePush(publicKey);
        setPushSubscribed(true);
      } else {
        await disablePush();
        setPushSubscribed(false);
      }
      setPreferences((current) => ({ ...current, push: enabled }));
    } catch (err) {
      // Leave the toggle unchanged so a denied prompt or failed subscribe rolls back.
      setPreferencesError(err instanceof Error ? err.message : 'Failed to update browser push.');
    }
  };

  const handleSavePreferences = async (): Promise<boolean> => {
    setPreferencesError(null);
    setIsPreferencesSaving(true);
    try {
      const saved = await api.notifications.updatePreferences(preferences);
      setPreferences(saved);
      return true;
    } catch (err) {
      setPreferencesError(err instanceof Error ? err.message : 'Failed to save notification preferences');
      return false;
    } finally {
      setIsPreferencesSaving(false);
    }
  };

  const handleSendTestPush = async () => {
    setPreferencesError(null);
    setTestPushSent(false);
    setIsTestingPush(true);
    try {
      await api.notifications.sendTestPush();
      setTestPushSent(true);
    } catch (err) {
      setPreferencesError(err instanceof Error ? err.message : 'Failed to send test notification');
    } finally {
      setIsTestingPush(false);
    }
  };

  const renderPreferences = () => (
    <div className="notification-preferences">
      {isPreferencesLoading && <p className="notifications-panel__status">Loading preferences...</p>}

      {!isPreferencesLoading && (
        <>
          {preferencesError && (
            <div className="notifications-panel__error">
              <IconAlertCircle size={18} strokeWidth={1.75} />
              <span>{preferencesError}</span>
            </div>
          )}

          <section className="notification-preferences__section">
            <h3>Delivery channels</h3>
            <Checkbox
              label="In-app notifications"
              checked={preferences.inApp}
              disabled={isPreferencesSaving}
              onChange={(event) => setPreferences((current) => ({ ...current, inApp: event.target.checked }))}
            />
            <Checkbox
              label="Email notifications"
              checked={preferences.email}
              disabled={isPreferencesSaving}
              onChange={(event) => setPreferences((current) => ({ ...current, email: event.target.checked }))}
            />
            <div className="notification-preferences__push">
              <Checkbox
                label="Browser push"
                checked={preferences.push}
                disabled={Boolean(pushUnavailableReason) || isPreferencesSaving}
                onChange={(event) => void handleTogglePush(event.target.checked)}
              />
              <p className="notification-preferences__hint">
                {pushUnavailableReason ?? (pushSubscribed
                  ? 'This browser is subscribed. Notifications can arrive while the tab is closed.'
                  : 'Turn this on to receive notifications even while the tab is closed.')}
              </p>
            </div>
          </section>

          <section className="notification-preferences__section">
            <h3>Notification types</h3>
            <p className="notification-preferences__hint">
              Uncheck a type to mute it across all enabled channels.
            </p>
            <div className="notification-preferences__types">
              {NOTIFICATION_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  label={NOTIFICATION_TYPE_LABELS[type]}
                  checked={preferences.types[type] ?? true}
                  disabled={isPreferencesSaving}
                  onChange={(event) => setPreferences((current) => ({
                    ...current,
                    types: { ...current.types, [type]: event.target.checked },
                  }))}
                />
              ))}
            </div>
          </section>

          {preferences.push && pushSubscribed && !pushUnavailableReason && (
            <div className="notification-preferences__test">
              <Button
                variant="secondary"
                onClick={() => void handleSendTestPush()}
                isLoading={isTestingPush}
              >
                <IconSend size={16} />
                Send test push
              </Button>
              {testPushSent && <span className="notification-preferences__hint">Test notification sent.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );

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
        <div className="notifications-panel__actions">
          <Tooltip content="Notification preferences">
            <Button
              variant="secondary"
              onClick={openPreferences}
              aria-label="Notification preferences"
            >
              <IconBellCog size={16} />
            </Button>
          </Tooltip>
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

      <Modal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onConfirm={handleSavePreferences}
        title="Notification preferences"
        confirmText="Save preferences"
        confirmDisabled={isPreferencesLoading}
        size="md"
      >
        {renderPreferences()}
      </Modal>
    </div>
  );
}
