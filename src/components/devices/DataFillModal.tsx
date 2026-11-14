import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Button, Modal } from '../common';
import { api } from '../../lib/api';
import './DataFillModal.css';

export interface DataFillModalProps {
  isOpen: boolean;
  onClose: () => void;
  serial: number;
  deviceName: string;
  onFilled: () => void;
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const DataFillModal = ({ isOpen, onClose, serial, deviceName, onFilled }: DataFillModalProps) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [start, setStart] = useState(toLocalInput(oneHourAgo));
  const [end, setEnd] = useState(toLocalInput(now));
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setIsSubmitting(false);
  }, [isOpen]);

  const preview = useMemo(() => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const intervalSeconds = Math.max(1, intervalMinutes) * 60;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    if (endDate <= startDate) return null;
    if (intervalSeconds < 60) return null;
    const count = Math.floor((endDate.getTime() - startDate.getTime()) / (intervalSeconds * 1000)) + 1;
    return { count, intervalSeconds };
  }, [start, end, intervalMinutes]);

  const handleFill = async () => {
    if (!preview) return;
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
          <IconAlertTriangle size={18} strokeWidth={1.75} />
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
          <span className="data-fill__label">Interval (minutes)</span>
          <input
            type="number"
            min={1}
            className="data-fill__input"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
          />
        </label>

        <div className="data-fill__summary">
          {preview ? (
            <>
              <span className="data-fill__label">Points to generate</span>
              <span className="data-fill__value">{preview.count.toLocaleString()}</span>
            </>
          ) : (
            <span className="data-fill__error-text">Enter a valid range and interval (≥ 1 minute).</span>
          )}
        </div>

        {error && <div className="data-fill__error">{error}</div>}

        <div className="data-fill__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleFill()} isLoading={isSubmitting} disabled={!preview}>
            Fill data
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DataFillModal;