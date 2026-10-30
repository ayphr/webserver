import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import './DnsChallengeModal.css';

export interface DnsChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: any;
  onCheck: () => void;
  isChecking: boolean;
  error: string | null;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <Button variant="secondary" onClick={() => void handleCopy()}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export const DnsChallengeModal = ({
  isOpen,
  onClose,
  challenge,
  onCheck,
  isChecking,
  error,
}: DnsChallengeModalProps) => {
  const recordName =
    challenge?.recordName ?? challenge?.txtName ?? challenge?.name ?? '';
  const recordValue =
    challenge?.recordValue ?? challenge?.txtValue ?? challenge?.value ?? challenge?.token ?? '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Verify website ownership" showCancel cancelText="Close">
      <div className="dns-challenge">
        <p>Add the following TXT record to your DNS, then click Check.</p>
        <label className="dns-challenge__label">TXT name</label>
        <div className="dns-challenge__row">
          <textarea
            className="dns-challenge__textarea"
            readOnly
            value={recordName}
            onFocus={(e) => e.target.select()}
          />
          <CopyButton value={recordName} />
        </div>
        <label className="dns-challenge__label">TXT value</label>
        <div className="dns-challenge__row">
          <textarea
            className="dns-challenge__textarea"
            readOnly
            value={recordValue}
            onFocus={(e) => e.target.select()}
          />
          <CopyButton value={recordValue} />
        </div>
        {error && <p className="profile-card__form-error">{error}</p>}
        <div className="dns-challenge__actions">
          <Button onClick={() => void onCheck()} isLoading={isChecking} disabled={isChecking}>
            Check
          </Button>
        </div>
      </div>
    </Modal>
  );
};