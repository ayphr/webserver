import { useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { Button, Modal } from '../common';
import { getPasswordValidationChecks, PASSWORD_RULES } from '@common/utils/password';
import '../common/ModalForm.css';

export interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose, onChanged }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = getPasswordValidationChecks(newPassword);
  const missingRules = PASSWORD_RULES.filter((rule) => !checks[rule.key]);
  const passwordsMatch = confirmPassword === newPassword;
  const isValid =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    missingRules.length === 0 &&
    passwordsMatch;

  const handleChange = async () => {
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }

    if (missingRules.length > 0) {
      setError('New password does not meet the requirements');
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change password" size="sm" showCancel={false}>
      <div className="modal-form__body">
        <div className="modal-form__section">
          <label htmlFor="change-password-current" className="modal-form__label">Current password</label>
          <input
            id="change-password-current"
            type="password"
            className="modal-form__input"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={isSaving}
            placeholder="Enter your current password"
            autoComplete="current-password"
          />
        </div>

        <div className="modal-form__section">
          <label htmlFor="change-password-new" className="modal-form__label">New password</label>
          <input
            id="change-password-new"
            type="password"
            className="modal-form__input"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={isSaving}
            placeholder="Enter a new password"
            autoComplete="new-password"
          />
        </div>

        <div className="modal-form__section">
          <label htmlFor="change-password-confirm" className="modal-form__label">Confirm new password</label>
          <input
            id="change-password-confirm"
            type="password"
            className="modal-form__input"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isSaving}
            placeholder="Re-enter the new password"
            autoComplete="new-password"
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="modal-form__mismatch">Passwords do not match</p>
          )}
        </div>

        {newPassword.length > 0 && missingRules.length > 0 && (
          <ul className="modal-form__rules">
            {missingRules.map((rule) => (
              <li key={rule.key} className="modal-form__rule">{rule.label}</li>
            ))}
          </ul>
        )}

        {error && (
          <div className="modal-form__error" role="alert">
            <IconAlertCircle aria-hidden="true" size={18} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-form__note">
          Changing your password signs out every device, including this one.
        </div>

        <div className="modal-form__footer">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleChange} isLoading={isSaving} disabled={isSaving || !isValid}>
            Change password
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ChangePasswordModal;