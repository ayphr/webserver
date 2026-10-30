import { Modal } from './Modal';
import { Button } from './Button';
import { CopyableField } from './CopyableField';
import './DnsChallengeModal.css';

export interface DnsChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: any;
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
    <Modal isOpen={isOpen} onClose={onClose} title="Verify website ownership" showCancel cancelText="Close">
      <div className="dns-challenge">
        <p>Add the following TXT record to your DNS, then click Check.</p>
        <CopyableField label="TXT name" value={recordName} />
        <CopyableField label="TXT value" value={recordValue} />
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