import { useEffect, useState } from 'react';
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconMapPin,
  IconAlertCircle,
} from '@tabler/icons-react';
import type { SessionInfo } from '../../../common';
import { api } from '../../lib/api';
import { Modal } from '../common';
import './SessionsModal.css';

export interface SessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function getRelativeTime(date: Date | string): string {
  const diffMs = Date.now() - toDate(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return toDate(date).toLocaleDateString('en-GB');
  }
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function getCountryName(code?: string): string | undefined {
  if (!code) return undefined;

  try {
    return regionDisplayNames.of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

function formatLocation(session: SessionInfo): string {
  const { city, country, countryName } = session.location;
  const resolvedCountry = countryName ?? getCountryName(country);

  if (city && resolvedCountry) return `${city}, ${resolvedCountry}`;
  return city ?? resolvedCountry ?? 'Unknown location';
}

function DeviceIcon({ deviceType }: { deviceType?: SessionInfo['deviceType'] }) {
  if (deviceType === 'mobile') return <IconDeviceMobile size={20} strokeWidth={1.75} />;
  if (deviceType === 'tablet') return <IconDeviceTablet size={20} strokeWidth={1.75} />;
  return <IconDeviceDesktop size={20} strokeWidth={1.75} />;
}

function describeClient(session: SessionInfo): string {
  const parts = [session.browser, session.os].filter(Boolean);
  if (parts.length > 0) return parts.join(' on ');
  return session.userAgent ? 'Unknown browser' : 'Unknown device';
}

export const SessionsModal = ({ isOpen, onClose }: SessionsModalProps) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await api.sessions.list();
        if (!cancelled) setSessions(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Active sessions" size="md" showCancel={false}>
      {isLoading && <p className="sessions-modal__status">Loading sessions...</p>}

      {!isLoading && error && (
        <div className="sessions-modal__error">
          <IconAlertCircle size={18} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <p className="sessions-modal__status">No active sessions found.</p>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <ul className="sessions-modal__list">
          {sessions.map((session) => (
            <li className="sessions-modal__item" key={session.id}>
              <span className="sessions-modal__icon">
                <DeviceIcon deviceType={session.deviceType} />
              </span>

              <div className="sessions-modal__details">
                <div className="sessions-modal__title-row">
                  <span className="sessions-modal__title">{describeClient(session)}</span>
                  {session.current && <span className="sessions-modal__badge">This device</span>}
                </div>

                <span className="sessions-modal__meta">
                  <IconMapPin size={14} strokeWidth={1.75} />
                  {formatLocation(session)}
                </span>

                <span className="sessions-modal__meta">
                  Last active {getRelativeTime(session.lastActive)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
