import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Button, Modal } from '../common';
import { api } from '../../lib/api';
import { formatDuration, parseDuration, type CreditBalance } from '@common';
import { formatCredits } from '../../lib/credits';
import './DataFillModal.css';

export interface DataFillModalProps {
  isOpen: boolean;
  onClose: () => void;
  serial: number;
  deviceName: string;
  onFilled: () => void;
  maxPoints?: number;
  credits?: CreditBalance | null;
  creditCostPerThousandPoints?: number;
  onCreditsChange?: (credits: CreditBalance) => void;
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const DataFillModal = ({ isOpen, onClose, serial, deviceName, onFilled, maxPoints = 1000, credits = null, creditCostPerThousandPoints = 1, onCreditsChange }: DataFillModalProps) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [start, setStart] = useState(toLocalInput(oneHourAgo));
  const [end, setEnd] = useState(toLocalInput(now));
  const [intervalInput, setIntervalInput] = useState('5m');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setIsSubmitting(false);
  }, [isOpen]);

  const intervalSeconds = useMemo(() => parseDuration(intervalInput, 'm'), [intervalInput]);

  const preview = useMemo(() => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    if (endDate <= startDate) return null;
    if (intervalSeconds === undefined || intervalSeconds < 1) return null;
    const count = Math.floor((endDate.getTime() - startDate.getTime()) / (intervalSeconds * 1000)) + 1;
    return { count, intervalSeconds };
  }, [start, end, intervalSeconds]);

  const exceedsLimit = Boolean(preview && preview.count > maxPoints);

  const creditCost = useMemo(() => {
    if (!preview) return null;
    return (preview.count / 1000) * creditCostPerThousandPoints;
  }, [preview, creditCostPerThousandPoints]);

  const hasEnoughCredits = useMemo(() => {
    if (creditCost === null) return true;
    if (!credits) return true;
    return credits.available >= creditCost;
  }, [creditCost, credits]);

  const handleFill = async () => {
    if (!preview || exceedsLimit) return;
    if (creditCost !== null && credits && credits.available < creditCost) {
      setError('You do not have enough credits to fill this data.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      await api.devices.dataFill(serial, {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        intervalSeconds: preview.intervalSeconds,
      });
      if (onCreditsChange) {
        try {
          const fresh = await api.credits.me();
          onCreditsChange(fresh);
        } catch {
          // ignore
        }
      }
      onFilled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fill data');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Fill mock data" size="md" showCancel={false}>
      <div className="data-fill">
        <div className="data-fill__warning">
          <IconAlertTriangle className="data-fill__warning-icon" size={18} strokeWidth={1.75} />
          <span>
            This will <strong>replace all existing telemetry</strong> for &quot;{deviceName}&quot; with
            generated mock data across the selected time range. This action cannot be undone.
          </span>
        </div>

        <label className="data-fill__field">
          <span className="data-fill__label">Start</span>
          <input
            type="datetime-local"
            className="data-fill__input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>

        <label className="data-fill__field">
          <span className="data-fill__label">End</span>
          <input
            type="datetime-local"
            className="data-fill__input"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>

        <label className="data-fill__field">
          <span className="data-fill__label">Interval</span>
          <input
            type="text"
            className="data-fill__input"
            value={intervalInput}
            onChange={(e) => setIntervalInput(e.target.value)}
            placeholder="e.g. 5m, 30s, 1h"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="data-fill__hint">
            {intervalSeconds === undefined || intervalSeconds < 1
              ? 'Enter a duration of at least 1 second (e.g. 5m, 30s, 1h).'
              : `One reading every ${formatDuration(intervalSeconds)}.`}
          </span>
        </label>

        <div className="data-fill__summary">
          {preview ? (
            <>
              <span className="data-fill__label">Points to generate</span>
              <span
                className="data-fill__value"
                style={exceedsLimit ? { color: 'red' } : undefined}
              >
                {preview.count.toLocaleString()} / {maxPoints.toLocaleString()}
              </span>
              {exceedsLimit && (
                <span className="data-fill__error-text">
                  Exceeds your plan limit of {maxPoints.toLocaleString()} points.
                </span>
              )}
              {creditCost !== null && (
                <div className="data-fill__credit-cost">
                  <span className="data-fill__label">Credit cost</span>
                  <span className="data-fill__value">{formatCredits(creditCost)} credits</span>
                </div>
              )}
              {creditCost !== null && !hasEnoughCredits && (
                <span className="data-fill__error-text">
                  You do not have enough credits to fill this data.
                </span>
              )}
            </>
          ) : (
            <span className="data-fill__error-text">Enter a valid range and interval.</span>
          )}
        </div>

        {error && <div className="data-fill__error">{error}</div>}

        <div className="data-fill__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleFill()} isLoading={isSubmitting} disabled={!preview || exceedsLimit || !hasEnoughCredits}>
            Fill data
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DataFillModal;
