import { useEffect, useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { Button, Modal, CodeInput } from '../common';
import { EMAIL_CODE_LENGTH, getEmailValidationError, normalizeEmail } from '@common/utils/email';
import type { SelfUser } from '@common';
import './ChangeEmailModal.css';

export interface ChangeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: (user: SelfUser) => void;
}

const RESEND_COOLDOWN_SECONDS = 30;

export const ChangeEmailModal: React.FC<ChangeEmailModalProps> = ({ isOpen, onClose, onChanged }) => {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleRequestCode = async () => {
    const emailError = getEmailValidationError(email.trim());
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await api.auth.requestEmailChange({ email: normalizeEmail(email), currentPassword });
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== EMAIL_CODE_LENGTH) {
      setError(`Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const user = await api.auth.confirmEmailChange({ email: normalizeEmail(email), code });
      onChanged?.(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify email');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.auth.requestEmailChange({ email: normalizeEmail(email), currentPassword });
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={step === 'email' ? 'Change email' : 'Verify email'} size="sm" showCancel={false}>
      <div className="change-email__body">
        {step === 'email' && (
          <>
            <div className="change-email__section">
              <label htmlFor="change-email-new" className="change-email__label">New email address</label>
              <input
                id="change-email-new"
                type="email"
                className="change-email__input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSaving}
                placeholder="Enter a new email"
                autoComplete="email"
              />
            </div>
            <div className="change-email__section">
              <label htmlFor="change-email-password" className="change-email__label">Current password</label>
              <input
                id="change-email-password"
                type="password"
                className="change-email__input"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={isSaving}
                placeholder="Enter your current password"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="change-email__error">
                <IconAlertCircle size={18} strokeWidth={1.75} />
                <span>{error}</span>
              </div>
            )}
            <div className="change-email__footer">
              <Button variant="secondary" onClick={onClose} disabled={isSaving}>Cancel</Button>
              <Button variant="primary" onClick={handleRequestCode} isLoading={isSaving} disabled={isSaving}>
                Send code
              </Button>
            </div>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="change-email__hint">
              We sent a {EMAIL_CODE_LENGTH}-digit code to <strong>{email}</strong>. Enter it to verify your new email.
            </p>
            <CodeInput value={code} onChange={setCode} disabled={isSaving} />
            {error && (
              <div className="change-email__error">
                <IconAlertCircle size={18} strokeWidth={1.75} />
                <span>{error}</span>
              </div>
            )}
            <div className="change-email__resend">
              <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isSaving}>
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </Button>
            </div>
            <div className="change-email__footer">
              <Button variant="secondary" onClick={() => { setStep('email'); setCode(''); setError(null); }} disabled={isSaving}>
                Back
              </Button>
              <Button variant="primary" onClick={handleConfirm} isLoading={isSaving} disabled={isSaving || code.length !== EMAIL_CODE_LENGTH}>
                Verify email
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ChangeEmailModal;