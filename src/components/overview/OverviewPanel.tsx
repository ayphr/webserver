import { useEffect, useMemo, useState } from 'react';
import {
  IconArrowRight,
  IconCoin,
  IconCreditCard,
  IconDeviceDesktop,
  IconMapPin,
} from '@tabler/icons-react';
import { PLAN_NAMES, type CreditBalance, type DeviceSummary, type Location, type PublicUser, type TeamInvite } from '@common';
import { api } from '../../lib/api';
import { formatCredits } from '../../lib/credits';
import { toDate } from '../../lib/date';
import { formatDeviceRelativeTime, isDeviceOnline } from '../../lib/deviceActivity';
import { UsernameDisplay } from '../common';
import './OverviewPanel.css';

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

type Props = {
  user: PublicUser;
  credits: CreditBalance | null;
  onNavigate: (tab: string) => void;
  onDeviceNavigate: (serial: number) => void;
};

export const OverviewPanel = ({ user, credits, onNavigate, onDeviceNavigate }: Props) => {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [loadedDevices, loadedLocations, loadedInvites] = await Promise.all([
          api.devices.listMine(),
          api.locations.listMine().catch(() => []),
          api.teams.pendingInvites().catch(() => []),
        ]);
        if (!active) return;
        setDevices(loadedDevices);
        setLocations(loadedLocations);
        setPendingInvites(loadedInvites);
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

  const onlineCount = useMemo(() => devices.filter(isDeviceOnline).length, [devices]);

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

  const handleAcceptInvite = async (token: string) => {
    try {
      await api.teams.acceptInvite(token);
      setPendingInvites((prev) => prev.filter((i) => i.token !== token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite');
    }
  };

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

      {pendingInvites.length > 0 && (
        <div className="overview__invites">
          <h3>Pending team invitations</h3>
          {pendingInvites.map((invite) => (
            <div key={invite.id} className="overview__invite">
              <span>
                Invited to join a team by {invite.invitedByUsername}
                {invite.migrateData ? ' (will migrate your devices/locations)' : ''}
              </span>
              <button type="button" onClick={() => handleAcceptInvite(invite.token)}>
                Accept
              </button>
            </div>
          ))}
        </div>
      )}

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

      <section className="overview__section">
        <div className="overview__section-header">
          <h3>Recent devices</h3>
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
              const online = isDeviceOnline(device);

              return (
                <button
                  key={device.serial}
                  type="button"
                  className="overview__device"
                  onClick={() => onDeviceNavigate(device.serial)}
                >
                  <span className={`overview__device-status ${online ? 'is-online' : 'is-offline'}`} aria-label={online ? 'Online' : 'Offline'} role="img" />
                  <span className="overview__device-main">
                    <span className="overview__device-name">{deviceLabel(device)}</span>
                    <span className="overview__device-meta">
                      {location?.name ?? 'No location'} · {formatDeviceRelativeTime(device.lastUploadAt)}
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
    </div>
  );
};

export default OverviewPanel;
