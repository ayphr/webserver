import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IconApps,
  IconArrowRight,
  IconCoin,
  IconCreditCard,
  IconDeviceDesktop,
  IconDeviceGamepad2,
  IconMapPin,
  IconPlugConnected,
  IconSettings,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { PLAN_NAMES, type CreditBalance, type DeviceSummary, type Location, type PublicUser } from '@common';
import { api } from '../../lib/api';
import { formatCredits } from '../../lib/credits';
import { UsernameDisplay } from '../common';
import './OverviewPanel.css';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isOnline(device: DeviceSummary): boolean {
  if (!device.lastUploadAt) return false;
  return Date.now() - toDate(device.lastUploadAt).getTime() <= ONLINE_THRESHOLD_MS;
}

function formatDate(value: Date | string): string {
  return toDate(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelativeTime(value: Date | string | undefined): string {
  if (!value) return 'Never';
  const diffSecs = Math.floor((Date.now() - toDate(value).getTime()) / 1000);
  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

function describeSubscription(user: PublicUser): string {
  const subscription = user.subscription;
  if (!subscription) return 'Free plan';
  const name = PLAN_NAMES[subscription.tier];
  if (!subscription.expiresAt) return name;
  return `${name} · ${subscription.source === 'attached' ? 'expires' : 'renews'} ${formatDate(subscription.expiresAt)}`;
}

type Props = {
  user: PublicUser;
  credits: CreditBalance | null;
  isStaff: boolean;
  isDeveloper: boolean;
  onNavigate: (tab: string) => void;
};

type QuickLink = {
  id: string;
  label: string;
  icon: ReactNode;
};

export const OverviewPanel = ({ user, credits, isStaff, isDeveloper, onNavigate }: Props) => {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [loadedDevices, loadedLocations] = await Promise.all([
          api.devices.listMine(),
          api.locations.listMine().catch(() => []),
        ]);
        if (!active) return;
        setDevices(loadedDevices);
        setLocations(loadedLocations);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load devices');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const onlineCount = useMemo(() => devices.filter(isOnline).length, [devices]);

  const recentDevices = useMemo(
    () =>
      [...devices]
        .sort((a, b) => {
          const aTime = toDate(a.lastUploadAt ?? a.registeredAt).getTime();
          const bTime = toDate(b.lastUploadAt ?? b.registeredAt).getTime();
          return bTime - aTime;
        })
        .slice(0, 3),
    [devices],
  );

  const planTier = credits?.plan ?? user.subscription?.tier ?? 'free';
  const planName = PLAN_NAMES[planTier];

  const quickLinks: QuickLink[] = [
    { id: 'devices', label: 'Devices', icon: <IconDeviceDesktop size={16} strokeWidth={1.75} /> },
    { id: 'locations', label: 'Locations', icon: <IconMapPin size={16} strokeWidth={1.75} /> },
    { id: 'profile', label: 'Profile', icon: <IconUser size={16} strokeWidth={1.75} /> },
    { id: 'subscription', label: 'Subscription', icon: <IconCreditCard size={16} strokeWidth={1.75} /> },
    { id: 'credits', label: 'Credits', icon: <IconCoin size={16} strokeWidth={1.75} /> },
    { id: 'connections', label: 'Connections', icon: <IconPlugConnected size={16} strokeWidth={1.75} /> },
    { id: 'settings', label: 'Settings', icon: <IconSettings size={16} strokeWidth={1.75} /> },
    { id: 'games', label: 'Games', icon: <IconDeviceGamepad2 size={16} strokeWidth={1.75} /> },
    ...(isStaff ? [{ id: 'users', label: 'Users', icon: <IconUsers size={16} strokeWidth={1.75} /> }] : []),
    ...(isDeveloper ? [{ id: 'my-apps', label: 'My Apps', icon: <IconApps size={16} strokeWidth={1.75} /> }] : []),
  ];

  return (
    <div className="overview">
      <div className="overview__greeting">
        <UsernameDisplay
          username={user.username}
          badges={user.badges}
          country={user.country}
          avatarUrl={user.avatarUrl}
          avatarSize={44}
        />
        <p>Welcome back. Here&apos;s a quick look at your account.</p>
      </div>

      <div className="overview__stats">
        <button type="button" className="overview__stat" onClick={() => onNavigate('devices')}>
          <span className="overview__stat-label">
            <IconDeviceDesktop size={16} strokeWidth={1.75} />
            Devices
          </span>
          <span className="overview__stat-value">{devices.length}</span>
          <span className="overview__stat-sub">
            {isLoading ? 'Loading…' : `${onlineCount} online`}
          </span>
        </button>

        <button type="button" className="overview__stat" onClick={() => onNavigate('credits')}>
          <span className="overview__stat-label">
            <IconCoin size={16} strokeWidth={1.75} />
            Credits
          </span>
          <span className="overview__stat-value">
            {credits ? formatCredits(credits.available) : '—'}
          </span>
          <span className="overview__stat-sub">Available to spend</span>
        </button>

        <button type="button" className="overview__stat" onClick={() => onNavigate('subscription')}>
          <span className="overview__stat-label">
            <IconCreditCard size={16} strokeWidth={1.75} />
            Plan
          </span>
          <span className="overview__stat-value">{planName}</span>
          <span className="overview__stat-sub">{user.subscription ? 'Active subscription' : 'Free account'}</span>
        </button>

        <button type="button" className="overview__stat" onClick={() => onNavigate('locations')}>
          <span className="overview__stat-label">
            <IconMapPin size={16} strokeWidth={1.75} />
            Locations
          </span>
          <span className="overview__stat-value">{isLoading ? '—' : locations.length}</span>
          <span className="overview__stat-sub">Device groups</span>
        </button>
      </div>

      <div className="overview__columns">
        <section className="overview__section">
          <div className="overview__section-header">
            <h3>Devices</h3>
            <button type="button" className="overview__text-button" onClick={() => onNavigate('devices')}>
              View all
            </button>
          </div>

          {isLoading ? (
            <p className="overview__muted">Loading devices…</p>
          ) : error ? (
            <p className="overview__muted">{error}</p>
          ) : recentDevices.length === 0 ? (
            <div className="overview__empty">
              <p>No devices linked yet.</p>
              <button type="button" className="overview__text-button" onClick={() => onNavigate('devices')}>
                Add your first device
              </button>
            </div>
          ) : (
            <div className="overview__device-list">
              {recentDevices.map((device) => {
                const location = locations.find((item) => item.id === device.locationId);
                const reading = device.latestDataPoint;
                const online = isOnline(device);

                return (
                  <button
                    key={device.serial}
                    type="button"
                    className="overview__device"
                    onClick={() => onNavigate('devices')}
                  >
                    <span className={`overview__device-status ${online ? 'is-online' : 'is-offline'}`} />
                    <span className="overview__device-main">
                      <span className="overview__device-name">{deviceLabel(device)}</span>
                      <span className="overview__device-meta">
                        {location?.name ?? 'No location'} · {formatRelativeTime(device.lastUploadAt)}
                      </span>
                    </span>
                    <span className="overview__device-reading">
                      {reading ? `${reading.temperature.toFixed(1)}°C · ${reading.humidity.toFixed(0)}%` : 'No data'}
                    </span>
                    <IconArrowRight size={14} strokeWidth={1.75} className="overview__device-arrow" />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="overview__section">
          <div className="overview__section-header">
            <h3>Account</h3>
            <button type="button" className="overview__text-button" onClick={() => onNavigate('profile')}>
              View profile
            </button>
          </div>

          <dl className="overview__details">
            <div className="overview__detail">
              <dt>Username</dt>
              <dd>{user.username}</dd>
            </div>
            <div className="overview__detail">
              <dt>Subscription</dt>
              <dd>{describeSubscription(user)}</dd>
            </div>
            <div className="overview__detail">
              <dt>Member since</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
            <div className="overview__detail">
              <dt>Role</dt>
              <dd>
                {isStaff ? 'Staff' : 'Member'}
                {isDeveloper ? ' · Developer' : ''}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="overview__section">
        <div className="overview__section-header">
          <h3>Quick links</h3>
        </div>
        <div className="overview__quick-links">
          {quickLinks.map((link) => (
            <button
              key={link.id}
              type="button"
              className="overview__quick-link"
              onClick={() => onNavigate(link.id)}
            >
              {link.icon}
              <span>{link.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export default OverviewPanel;
