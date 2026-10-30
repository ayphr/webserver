import { Modal } from './Modal';
import { Button } from './Button';
import { CopyableField } from './CopyableField';
import type { DomainChallengePayload } from '@common';
import './DnsChallengeModal.css';

export interface DnsChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: DomainChallengePayload | null;
  onCheck: () => void;
  isChecking: boolean;
  error: string | null;
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
    <Modal isOpen={isOpen} onClose={onClose} title="Verify website ownership" showCancel={false}>
      <div className="dns-challenge">
        <p>Add the following TXT record to your DNS, then click Check.</p>
        <CopyableField label="TXT name" value={recordName} />
        <CopyableField label="TXT value" value={recordValue} />
        <div className="dns-challenge__error">
          {error ? <p className="profile-card__form-error">{error}</p> : null}
          {error ? <p className="dns-challenge__note">DNS changes can take a few minutes to propagate.</p> : null}
        </div>
        <div className="dns-challenge__actions">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void onCheck()} isLoading={isChecking} disabled={isChecking}>
            Check
          </Button>
        </div>
      </div>
    </Modal>
  );
};