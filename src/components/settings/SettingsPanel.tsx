import { useState } from 'react';
import { Button, Checkbox, ConfirmDialog, Input } from '../common';
import type { ButtonSettingsOption, SettingsSection } from '../../lib/settings';
import './SettingsPanel.css';

export const SettingsPanel = ({ sections }: { sections: SettingsSection[] }) => {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmOption, setConfirmOption] = useState<ButtonSettingsOption | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runButton = async (option: ButtonSettingsOption, password?: string) => {
    setError(null);
    setPendingId(option.id);

    try {
      await option.action({ password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong, please try again');
    } finally {
      setPendingId(null);
    }
  };

  const closeConfirm = () => {
    setConfirmOption(null);
    setConfirmPassword('');
  };

  const handlePress = (option: ButtonSettingsOption) => {
    if (option.confirm) {
      setConfirmPassword('');
      setConfirmOption(option);
      return;
    }
    void runButton(option);
  };

  const handleConfirm = () => {
    const option = confirmOption;
    if (!option) return;
    if (option.confirm?.requirePassword && !confirmPassword) return;
    const password = confirmPassword;
    closeConfirm();
    void runButton(option, password);
  };

  const renderControl = (option: SettingsSection['options'][number]) => {
    switch (option.optionType) {
      case 'button': {
        const variant = option.variant ?? (option.danger ? 'danger' : 'secondary');
        return (
          <Button
            variant={variant}
            isLoading={pendingId === option.id}
            disabled={option.disabled || pendingId !== null}
            onClick={() => handlePress(option)}
          >
            {option.label}
          </Button>
        );
      }
      case 'checkbox':
        return (
          <Checkbox
            checked={option.checked}
            disabled={option.disabled}
            onChange={(e) => option.onChange(e.target.checked)}
          />
        );
      case 'input':
        return (
          <Input
            value={option.value}
            placeholder={option.placeholder}
            type={option.inputType ?? 'text'}
            disabled={option.disabled}
            className="settings-option__input"
            onChange={(e) => option.onChange(e.target.value)}
          />
        );
      case 'select': {
        const normalized = option.options.map((entry) =>
          typeof entry === 'string' ? { value: entry, label: entry } : entry,
        );
        return (
          <select
            value={option.value}
            disabled={option.disabled}
            onChange={(e) => option.onChange(e.target.value)}
          >
            {normalized.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="settings">
      {error && <div className="settings__error">{error}</div>}

      {sections.map((section) => (
        <section className="settings__section" key={section.id}>
          {section.title && <h3 className="settings__subheading">{section.title}</h3>}
          {section.description && (
            <p className="settings__section-description">{section.description}</p>
          )}

          <div className="settings__options">
            {section.options.map((option) => (
              <div
                className={`settings__option ${option.danger ? 'settings__option--danger' : ''} ${option.disabled ? 'settings__option--disabled' : ''}`}
                key={option.id}
              >
                {option.icon && <span className="settings__option-icon">{option.icon}</span>}
                <div className="settings__option-text">
                  <span className="settings__option-title">{option.title}</span>
                  {option.description && (
                    <span className="settings__option-description">{option.description}</span>
                  )}
                </div>
                <div className="settings__option-control">{renderControl(option)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <ConfirmDialog
        isOpen={confirmOption !== null}
        title={confirmOption?.confirm?.title ?? 'Are you sure?'}
        confirmText={confirmOption?.confirm?.confirmText ?? 'Confirm'}
        cancelText={confirmOption?.confirm?.cancelText ?? 'Cancel'}
        isDangerous={confirmOption?.confirm?.dangerous ?? confirmOption?.danger ?? false}
        confirmDisabled={Boolean(confirmOption?.confirm?.requirePassword) && !confirmPassword}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      >
        {confirmOption?.confirm?.message && <p>{confirmOption.confirm.message}</p>}
        {confirmOption?.confirm?.requirePassword && (
          <Input
            type="password"
            value={confirmPassword}
            placeholder="Enter your password"
            className="settings-option__input"
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        )}
      </ConfirmDialog>
    </div>
  );
};