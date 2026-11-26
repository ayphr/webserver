import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconKey, IconMapPin, IconTrash, IconAlertCircle, IconClock } from '@tabler/icons-react';
import type { DeviceUploadTokenInfo } from '@common';
import { api } from '../../lib/api';
import { formatDisplayDate, getRelativeTime, toDate } from '../../lib/date';
import { formatLocation } from '../../lib/region';
import { queryKeys } from '../../lib/query';
import { Button, ConfirmDialog } from '../common';
import './TokensTab.css';

type Props = {
  serial: number;
  deviceName: string;
};

export function TokensTab({ serial, deviceName }: Props) {
  const queryClient = useQueryClient();
  const tokensQuery = useQuery({
    queryKey: queryKeys.deviceTokens(serial),
    queryFn: () => api.devices.listTokens(serial),
    meta: { persist: false },
  });
  const tokens = tokensQuery.data ?? [];
  const isLoading = !tokensQuery.data && tokensQuery.isPending;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? (tokensQuery.error instanceof Error ? tokensQuery.error.message : tokensQuery.error ? 'Failed to load tokens' : null);
  const [tokenToRevoke, setTokenToRevoke] = useState<DeviceUploadTokenInfo | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleRevoke = async () => {
    const token = tokenToRevoke;
    if (!token) return;
    setTokenToRevoke(null);
    setRevokingId(token.id);
    setActionError(null);
    try {
      await api.devices.revokeToken(serial, token.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.deviceTokens(serial) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke token');
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