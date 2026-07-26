import { useState } from 'react';
import { api } from '../../lib/api';
import { Modal, Button } from './index';
import './PunishModal.css';
import type { Punishment } from '../../../common';

export interface PunishModalProps {
  userUuid: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
  onPunish?: (punishment: Punishment) => void;
  isSelfPunishment?: boolean;
  onSelfPunishment?: () => void;
}

function parseDurationString(input: string): number | undefined {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'permanent') {
    return -1;
  }

  if (!trimmed) {
    return undefined;
  }

  // Parse patterns like "1w", "1w2d", "1w2d3h", "3h30m", etc.
  let totalMinutes = 0;

  const patterns = [
    { regex: /(\d+)\s*w(?!ord)/gi, multiply: 7 * 24 * 60 },  // weeks
    { regex: /(\d+)\s*d(?!ay)/gi, multiply: 24 * 60 },        // days
    { regex: /(\d+)\s*h(?!our)/gi, multiply: 60 },            // hours
    { regex: /(\d+)\s*m(?!in)?(?!onth)/gi, multiply: 1 },     // minutes
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(input)) !== null) {
      totalMinutes += Number.parseInt(match[1], 10) * pattern.multiply;
    }
  }

  return totalMinutes > 0 ? totalMinutes : undefined;
}

function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined) {
    return 'Empty';
  }

  if (minutes === -1) {
    return 'Permanent';
  }

  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours < 24) {
    if (mins > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days < 7) {
    if (remainingHours > 0) {
      return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
    }
    return `${days} day${days !== 1 ? 's' : ''}`;
  }

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  if (remainingDays > 0) {
    return `${weeks} week${weeks !== 1 ? 's' : ''} ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
  }
  return `${weeks} week${weeks !== 1 ? 's' : ''}`;
}

export const PunishModal: React.FC<PunishModalProps> = ({
  userUuid,
  username,
  isOpen,
  onClose,
  onPunish,
  isSelfPunishment = false,
  onSelfPunishment,
}) => {
  const [durationInput, setDurationInput] = useState('1d');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationMinutes = parseDurationString(durationInput);
  const durationFormatted = formatMinutes(durationMinutes);
  const isValidDuration = durationMinutes !== undefined;
  const isConfirmDisabled = !reason.trim() || !durationInput.trim() || !isValidDuration;

  const handlePunish = async () => {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }

    if (!durationInput.trim() || !isValidDuration) {
      setError('Valid duration is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const punishment = await api.staff.punishments.issue({
        userUuid,
        reason,
        durationMinutes,
      });

      if (isSelfPunishment) {
        onSelfPunishment?.();
      } else {
        onPunish?.(punishment);
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to issue punishment';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Suspend ${username}`} size="sm" showCancel={false}>
      <div className="punish-modal__body">
        <div className="punish-modal__section">
          <label htmlFor="duration" className="punish-modal__label">Duration</label>
          <p className="punish-modal__hint">Enter duration like: 1h, 1d, 1w, 1w2d3h, or permanent</p>
          <div className="punish-modal__duration-wrapper">
            <input
              id="duration"
              type="text"
              className="punish-modal__duration-input"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              disabled={isLoading}
              placeholder="e.g., 1d or 1w2d"
            />
            <div className="punish-modal__duration-display">
              {durationFormatted}
            </div>
          </div>
        </div>

        <div className="punish-modal__section">
          <label htmlFor="reason" className="punish-modal__label">Reason</label>
          <textarea
            id="reason"
            className="punish-modal__textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isLoading}
            placeholder="Explain the suspension..."
            rows={4}
          />
        </div>

        {error && <div className="punish-modal__error">{error}</div>}

        <div className="punish-modal__footer">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handlePunish}
            isLoading={isLoading}
            disabled={isLoading || isConfirmDisabled}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
};
