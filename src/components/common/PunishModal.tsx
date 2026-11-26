import { useState } from 'react';
import { api } from '../../lib/api';
import { Modal, Button } from './index';
import './PunishModal.css';
import { formatDuration, parseDuration } from '@common';
import type { Punishment } from '@common';

export interface PunishModalProps {
  userUuid: string;
  username: string;
  isOpen: boolean;
  onClose: () => void;
  onPunish?: (punishment: Punishment) => void;
  isSelfPunishment?: boolean;
  onSelfPunishment?: () => void;
}

/** Parses a compact duration into minutes, or -1 for a permanent punishment. */
function parseDurationMinutes(input: string): number | undefined {
  if (input.trim().toLowerCase() === 'permanent') return -1;
  const seconds = parseDuration(input, 'm');
  if (seconds === undefined) return undefined;
  return Math.max(1, Math.round(seconds / 60));
}

function formatDurationMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return 'Empty';
  if (minutes === -1) return 'Permanent';
  return formatDuration(minutes * 60);
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

  const durationMinutes = parseDurationMinutes(durationInput);
  const durationFormatted = formatDurationMinutes(durationMinutes);
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
    <Modal isOpen={isOpen} onClose={onClose} title={`Suspend ${username}`} size="md" showCancel={false}>
      <div className="punish-modal__body">
        <div className="punish-modal__section">
          <label className="punish-modal__label">Duration</label>
          <div className="punish-modal__presets">
            {[
              { label: '1 hour', value: '1h' },
              { label: '1 day', value: '1d' },
              { label: '3 days', value: '3d' },
              { label: '1 week', value: '1w' },
              { label: '2 weeks', value: '2w' },
              { label: 'Permanent', value: 'permanent' },
            ].map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`punish-modal__preset ${durationInput === preset.value ? 'punish-modal__preset--active' : ''}`}
                onClick={() => setDurationInput(preset.value)}
                disabled={isLoading}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="punish-modal__hint">Or enter a custom duration (e.g. 1w2d3h, 30m) or "permanent"</p>
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

        {error && <div className="punish-modal__error" role="alert">{error}</div>}

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
