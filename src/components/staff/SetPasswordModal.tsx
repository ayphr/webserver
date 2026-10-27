import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Modal } from '../common';
import { getPasswordValidationChecks } from '@common/utils/password';
import './SetPasswordModal.css';

export interface SetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  userUuid: string;
  username: string;
  onChanged?: (user?: import('@common').PublicUser) => void;
}

const lowercaseLabel = 'At least one lowercase letter';
const uppercaseLabel = 'At least one uppercase letter';
const numberLabel = 'At least one number';
const symbolLabel = 'At least one special character';
const minLengthLabel = 'At least 12 characters';

const RULES: { key: keyof ReturnType<typeof getPasswordValidationChecks>; label: string }[] = [
  { key: 'minLength', label: minLengthLabel },
  { key: 'lowercase', label: lowercaseLabel },
  { key: 'uppercase', label: uppercaseLabel },
  { key: 'number', label: numberLabel },
  { key: 'symbol', label: symbolLabel },
];

export const SetPasswordModal: React.FC<SetPasswordModalProps> = ({
  isOpen,
  onClose,
  userUuid,
  username,
  onChanged,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = getPasswordValidationChecks(password);
  const missingRules = RULES.filter((rule) => !checks[rule.key]);
  const passwordsMatch = confirmPassword === password;
  const isValid = password.length > 0 && missingRules.length === 0 && passwordsMatch;

  const handleSet = async () => {
    if (missingRules.length > 0) {
      setError('Password does not meet the requirements');
      return;
    }

    if (!passwordsMatch) {
      setError('Passwords do not match');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await api.staff.setPassword(userUuid, { password });
      onChanged?.(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Set password for ${username}`} size="sm" showCancel={false}>
      <div className="set-password__body">
        <div className="set-password__section">
          <label htmlFor="set-password" className="set-password__label">New password</label>
          <input
            id="set-password"
            type="password"
            className="set-password__input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSaving}
            placeholder="Enter a new password"
            autoComplete="new-password"
          />
        </div>

        <div className="set-password__section">
          <label htmlFor="set-password-confirm" className="set-password__label">Confirm password</label>
          <input
            id="set-password-confirm"
            type="password"
            className="set-password__input"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isSaving}
            placeholder="Re-enter the new password"
            autoComplete="new-password"
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="set-password__mismatch">Passwords do not match</p>
          )}
        </div>

        {password.length > 0 && missingRules.length > 0 && (
          <ul className="set-password__rules">
            {missingRules.map((rule) => (
              <li key={rule.key} className="set-password__rule">{rule.label}</li>
            ))}
          </ul>
        )}

        <p className="set-password__hint">This user will be signed out of all devices.</p>

        {error && <div className="set-password__error">{error}</div>}

        <div className="set-password__footer">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSet} isLoading={isSaving} disabled={isSaving || !isValid}>
            Set password
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default SetPasswordModal;
