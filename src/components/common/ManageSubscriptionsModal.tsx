import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Modal, Button } from './index';
import { getBadgeIcon } from '../../lib/badges';
import { BADGES, SUBSCRIPTION_TIERS } from '@common';
import type { AttachedSubscription, PublicUser, SubscriptionTier } from '@common';
import './ManageSubscriptionsModal.css';

const MAX_REASON_LENGTH = 500;

function getTierName(tier: SubscriptionTier): string {
  return BADGES.find((badge) => badge.id === tier)?.name ?? tier;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDate(value: Date | string): string {
  return toDate(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRemaining(expiresAt: Date | string | null): string {
  if (!expiresAt) return 'Never expires';

  const diff = toDate(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

export interface ManageSubscriptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userUuid: string;
  username: string;
  onChanged?: (user?: PublicUser) => void;
}

export const ManageSubscriptionsModal: React.FC<ManageSubscriptionsModalProps> = ({
  isOpen,
  onClose,
  userUuid,
  username,
  onChanged,
}) => {
  const [subscriptions, setSubscriptions] = useState<AttachedSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [tier, setTier] = useState<SubscriptionTier>('plus');
  const [expiresInput, setExpiresInput] = useState('');
  const [reason, setReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await api.staff.subscriptions.list(userUuid);
        if (!cancelled) setSubscriptions(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load subscriptions');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isOpen, userUuid, reloadToken]);

  const resetForm = () => {
    setTier('plus');
    setExpiresInput('');
    setReason('');
    setEditingId(null);
  };

  const handleEdit = (subscription: AttachedSubscription) => {
    setEditingId(subscription.id);
    setTier(subscription.tier);
    setExpiresInput(subscription.expiresAt ? toDatetimeLocal(toDate(subscription.expiresAt)) : '');
    setReason(subscription.reason ?? '');
    setError(null);
  };

  const handleSubmit = async () => {
    if (expiresInput && new Date(expiresInput).getTime() <= Date.now()) {
      setError('Expiry must be in the future');
      return;
    }

    setIsSaving(true);
    setError(null);

    const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;

    try {
      if (editingId) {
        await api.staff.subscriptions.update(userUuid, editingId, {
          tier,
          expiresAt,
          reason: reason.trim(),
        });
      } else {
        const user = await api.staff.subscriptions.attach(userUuid, {
          tier,
          expiresAt,
          reason: reason.trim() || undefined,
        });
        onChanged?.(user);
      }

      resetForm();
      setReloadToken((token) => token + 1);
      if (editingId) onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subscription');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (subscriptionId: string) => {
    setIsSaving(true);
    setError(null);

    try {
      const user = await api.staff.subscriptions.detach(userUuid, subscriptionId);
      setConfirmingId(null);
      if (editingId === subscriptionId) resetForm();
      onChanged?.(user);
      setReloadToken((token) => token + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove subscription');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${username}'s subscriptions`} size="md" showCancel={false}>
      <div className="manage-subs__body">
        <section className="manage-subs__section">
          <h3 className="manage-subs__heading">Attached subscriptions</h3>

          {isLoading ? (
            <p className="manage-subs__hint">Loading subscriptions...</p>
          ) : subscriptions.length === 0 ? (
            <p className="manage-subs__hint">This user has no attached subscriptions.</p>
          ) : (
            <ul className="manage-subs__list">
              {subscriptions.map((subscription) => (
                <li key={subscription.id} className="manage-subs__item">
                  <div className="manage-subs__itemMain">
                    <span className="manage-subs__itemIcon">{getBadgeIcon(subscription.tier)}</span>
                    <div className="manage-subs__itemInfo">
                      <div className="manage-subs__itemTitle">
                        <strong>{getTierName(subscription.tier)}</strong>
                        <span className="manage-subs__itemExpiry">
                          {subscription.expiresAt
                            ? `${formatDate(subscription.expiresAt)} (${formatRemaining(subscription.expiresAt)})`
                            : 'Never expires'}
                        </span>
                      </div>
                      {subscription.reason && (
                        <p className="manage-subs__itemReason">{subscription.reason}</p>
                      )}
                      <p className="manage-subs__itemMeta">
                        Granted by {subscription.addedByUsername ?? 'staff'} on {formatDate(subscription.createdAt)}
                      </p>
                    </div>
                  </div>

                  {confirmingId === subscription.id ? (
                    <div className="manage-subs__itemActions">
                      <Button
                        variant="danger"
                        onClick={() => handleRemove(subscription.id)}
                        isLoading={isSaving}
                        disabled={isSaving}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmingId(null)}
                        disabled={isSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="manage-subs__itemActions">
                      <Button variant="secondary" onClick={() => handleEdit(subscription)} disabled={isSaving}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setConfirmingId(subscription.id)} disabled={isSaving}>
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="manage-subs__section">
          <h3 className="manage-subs__heading">
            {editingId ? 'Edit subscription' : 'Grant a subscription'}
          </h3>

          <div className="manage-subs__field">
            <label htmlFor="manage-subs-tier" className="manage-subs__label">Tier</label>
            <select
              id="manage-subs-tier"
              className="manage-subs__select"
              value={tier}
              onChange={(event) => setTier(event.target.value as SubscriptionTier)}
              disabled={isSaving}
            >
              {SUBSCRIPTION_TIERS.map((option) => (
                <option key={option} value={option}>
                  {getTierName(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="manage-subs__field">
            <label htmlFor="manage-subs-expiry" className="manage-subs__label">Expiry</label>
            <p className="manage-subs__hint">Leave blank for a subscription that never expires.</p>
            <input
              id="manage-subs-expiry"
              type="datetime-local"
              className="manage-subs__input"
              value={expiresInput}
              onChange={(event) => setExpiresInput(event.target.value)}
              disabled={isSaving}
            />
          </div>

          <div className="manage-subs__field">
            <label htmlFor="manage-subs-reason" className="manage-subs__label">Reason</label>
            <textarea
              id="manage-subs-reason"
              className="manage-subs__textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, MAX_REASON_LENGTH))}
              disabled={isSaving}
              placeholder="Optional note about why this subscription was granted..."
              rows={3}
            />
          </div>

          {error && <div className="manage-subs__error">{error}</div>}

          <div className="manage-subs__footer">
            {editingId && (
              <Button variant="secondary" onClick={resetForm} disabled={isSaving}>
                Cancel edit
              </Button>
            )}
            <Button variant="primary" onClick={handleSubmit} isLoading={isSaving} disabled={isSaving}>
              {editingId ? 'Save changes' : 'Grant subscription'}
            </Button>
          </div>
        </section>

        <div className="manage-subs__close">
          <Button variant="secondary" onClick={onClose} disabled={isSaving} fullWidth>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
