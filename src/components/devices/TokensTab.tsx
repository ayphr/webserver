import { useEffect, useState } from 'react';
import { IconKey, IconMapPin, IconTrash, IconAlertCircle, IconClock } from '@tabler/icons-react';
import type { DeviceUploadTokenInfo } from '@common';
import { api } from '../../lib/api';
import { formatDisplayDate, getRelativeTime, toDate } from '../../lib/date';
import { formatLocation } from '../../lib/region';
import { Button, ConfirmDialog } from '../common';
import './TokensTab.css';

type Props = {
  serial: number;
  deviceName: string;
};

export function TokensTab({ serial, deviceName }: Props) {
  const [tokens, setTokens] = useState<DeviceUploadTokenInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tokenToRevoke, setTokenToRevoke] = useState<DeviceUploadTokenInfo | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.devices.listTokens(serial);
        if (!cancelled) setTokens(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tokens');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serial, reloadToken]);

  const handleRevoke = async () => {
    const token = tokenToRevoke;
    if (!token) return;
    setTokenToRevoke(null);
    setRevokingId(token.id);
    setError(null);
    try {
      await api.devices.revokeToken(serial, token.id);
      setReloadToken((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    } finally {
      setRevokingId(null);
    }
  };

  const sorted = [...tokens].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const aUsed = a.lastUsedAt ? toDate(a.lastUsedAt).getTime() : 0;
    const bUsed = b.lastUsedAt ? toDate(b.lastUsedAt).getTime() : 0;
    if (aUsed !== bUsed) return bUsed - aUsed;
    return toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime();
  });

  if (isLoading) {
    return <p className="tokens-tab__notice">Loading tokens…</p>;
  }

  return (
    <div className="tokens-tab">
      {error && (
        <div className="tokens-tab__error">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="tokens-tab__empty">
          <IconKey size={28} strokeWidth={1.5} aria-hidden="true" />
          <h3>No upload tokens</h3>
          <p>This device has no upload tokens yet. Tokens are created when the device is linked.</p>
        </div>
      ) : (
        <ul className="tokens-tab__list">
          {sorted.map((token) => (
            <li key={token.id} className={`tokens-tab__item ${token.active ? 'is-active' : 'is-inactive'}`}>
              <span className="tokens-tab__icon">
                <IconKey size={20} strokeWidth={1.75} />
              </span>
              <div className="tokens-tab__details">
                <div className="tokens-tab__title-row">
                  <span className={`tokens-tab__badge ${token.active ? 'is-active' : 'is-inactive'}`}>
                    {token.active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="tokens-tab__title">
                    {token.active ? 'Upload token' : 'Revoked token'}
                  </span>
                </div>
                <span className="tokens-tab__meta">
                  <IconMapPin size={14} strokeWidth={1.75} />
                  {formatLocation(token.location)}
                </span>
                <span className="tokens-tab__meta">
                  <IconClock size={14} strokeWidth={1.75} />
                  {token.lastUsedAt ? `Last used ${getRelativeTime(token.lastUsedAt)}` : 'Never used'}
                </span>
                <span className="tokens-tab__meta">
                  Created {formatDisplayDate(token.createdAt)}
                </span>
              </div>
              {token.active && (
                <div className="tokens-tab__actions">
                  <Button
                    variant="danger"
                    disabled={revokingId !== null}
                    isLoading={revokingId === token.id}
                    onClick={() => setTokenToRevoke(token)}
                  >
                    <IconTrash size={14} strokeWidth={1.9} />
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={tokenToRevoke !== null}
        title="Revoke upload token"
        confirmText="Revoke"
        cancelText="Cancel"
        isDangerous
        onConfirm={() => void handleRevoke()}
        onCancel={() => setTokenToRevoke(null)}
      >
        {tokenToRevoke && (
          <p>
            Revoke this upload token for <strong>{deviceName}</strong>? The device will need a new token to upload
            telemetry.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}