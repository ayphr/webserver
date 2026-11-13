import { useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { Button, Input, Modal } from '../common';
import { getUsernameValidationError } from '@common/utils/username';
import './ChangePasswordModal.css';

export interface ChangeUsernameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: (user: import('@common').SelfUser) => void;
}

export const ChangeUsernameModal: React.FC<ChangeUsernameModalProps> = ({ isOpen, onClose, onChanged }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameError = newUsername.trim() ? getUsernameValidationError(newUsername.trim()) : null;
  const isValid = currentPassword.length > 0 && newUsername.trim().length > 0 && !usernameError;

  const handleChange = async () => {
    const trimmed = newUsername.trim();
    const validationError = getUsernameValidationError(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const user = await api.users.changeUsername(trimmed, currentPassword);
      onChanged?.(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change username');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change username" size="sm" showCancel={false}>
      <div className="change-password__body">
        <Input
          label="New username"
          type="text"
          value={newUsername}
          onChange={(event) => setNewUsername(event.target.value)}
          disabled={isSaving}
          placeholder="Enter a new username"
          autoComplete="username"
          error={newUsername.trim().length > 0 ? usernameError ?? undefined : undefined}
          fullWidth
        />

        <Input
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={isSaving}
          placeholder="Enter your current password"
          autoComplete="current-password"
          fullWidth
        />

        {error && (
          <div className="change-password__error">
            <IconAlertCircle size={18} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <div className="change-password__note">
          You can change your username once every 29 days.
        </div>

        <div className="change-password__footer">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleChange()} isLoading={isSaving} disabled={isSaving || !isValid}>
            Change username
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ChangeUsernameModal;