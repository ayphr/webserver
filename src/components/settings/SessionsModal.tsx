import { useEffect, useState } from 'react';
import {
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDeviceTv,
  IconMapPin,
  IconAlertCircle,
  IconLogout2,
} from '@tabler/icons-react';
import type { SessionInfo } from '@common';
import { api } from '../../lib/api';
import { getRelativeTime } from '../../lib/date';
import { formatLocation } from '../../lib/region';
import { Button, ConfirmDialog, Modal } from '../common';
import './SessionsModal.css';

export interface SessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function DeviceIcon({ deviceType }: { deviceType?: SessionInfo['deviceType'] }) {
  switch (deviceType) {
    case 'phone':
      return <IconDeviceMobile size={20} strokeWidth={1.75} />;
    case 'tablet':
      return <IconDeviceTablet size={20} strokeWidth={1.75} />;
    case 'laptop':
      return <IconDeviceLaptop size={20} strokeWidth={1.75} />;
    case 'tv':
      return <IconDeviceTv size={20} strokeWidth={1.75} />;
    case 'desktop':
      return <IconDeviceDesktop size={20} strokeWidth={1.75} />;
    default:
      return <IconDeviceDesktop size={20} strokeWidth={1.75} />;
  }
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
  const [reloadToken, setReloadToken] = useState(0);
  const [sessionToRevoke, setSessionToRevoke] = useState<SessionInfo | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isLogoutOthersOpen, setIsLogoutOthersOpen] = useState(false);
  const [isSigningOutOthers, setIsSigningOutOthers] = useState(false);
  const otherSessionCount = sessions.filter((session) => !session.current).length;

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
  }, [isOpen, reloadToken]);

  const handleRevoke = async () => {
    const session = sessionToRevoke;
    if (!session) return;

    setSessionToRevoke(null);
    setRevokingId(session.id);
    setError(null);

    try {
      await api.sessions.remove(session.id);
      setReloadToken((token) => token + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out session');
    } finally {
      setRevokingId(null);
    }
  };

  const handleLogoutOthers = async () => {
    setIsLogoutOthersOpen(false);
    setIsSigningOutOthers(true);
    setError(null);

    try {
      await api.auth.logoutOthers();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out other sessions');
    } finally {
      setIsSigningOutOthers(false);
    }
  };

  return (
    <>
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

        {!isLoading && otherSessionCount > 0 && (
          <div className="sessions-modal__bulk">
            <Button
              variant="secondary"
              onClick={() => setIsLogoutOthersOpen(true)}
              disabled={isSigningOutOthers || revokingId !== null}
              isLoading={isSigningOutOthers}
            >
              <IconLogout2 size={16} strokeWidth={1.75} />
              Sign out all other sessions
            </Button>
          </div>
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
                    {formatLocation(session.location)}
                  </span>

                  <span className="sessions-modal__meta">
                    Last active {getRelativeTime(session.lastActive)}
                  </span>
                </div>

                {!session.current && (
                  <div className="sessions-modal__actions">
                    <Button
                      variant="secondary"
                      disabled={revokingId !== null}
                      isLoading={revokingId === session.id}
                      onClick={() => setSessionToRevoke(session)}
                    >
                      Sign out
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={sessionToRevoke !== null}
        title="Sign out device"
        confirmText="Sign out"
        cancelText="Cancel"
        isDangerous
        onConfirm={handleRevoke}
        onCancel={() => setSessionToRevoke(null)}
      >
        {sessionToRevoke && (
          <p>
            Sign out <strong>{describeClient(sessionToRevoke)}</strong> ({formatLocation(sessionToRevoke.location)})? That
            device will need to log in again.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={isLogoutOthersOpen}
        title="Sign out all other sessions"
        confirmText="Sign out others"
        cancelText="Cancel"
        isDangerous
        confirmDisabled={isSigningOutOthers}
        onConfirm={() => void handleLogoutOthers()}
        onCancel={() => setIsLogoutOthersOpen(false)}
      >
        <p>
          This will sign out {otherSessionCount} other session{otherSessionCount === 1 ? '' : 's'}. This device will stay
          signed in.
        </p>
      </ConfirmDialog>
    </>
  );
};
