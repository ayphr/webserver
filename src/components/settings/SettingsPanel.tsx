import { useState } from 'react';
import { Button, Checkbox, ConfirmDialog, Input } from '../common';
import type { ButtonSettingsOption, SettingsSection } from '../../lib/settings';
import './SettingsPanel.css';

export interface SettingsPanelProps {
  sections: SettingsSection[];
  /** ID of the section that should be shown first. Defaults to the first section. */
  defaultTab?: string;
}

export const SettingsPanel = ({ sections, defaultTab }: SettingsPanelProps) => {
  const [requestedId, setRequestedId] = useState<string>(() => {
    if (defaultTab && sections.some((section) => section.id === defaultTab)) {
      return defaultTab;
    }
    return sections[0]?.id ?? '';
  });

  // Fall back to the first available section when the requested one disappears.
  const activeId =
    sections.length === 0
      ? ''
      : sections.some((section) => section.id === requestedId)
        ? requestedId
        : sections[0].id;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmOption, setConfirmOption] = useState<ButtonSettingsOption | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0] ?? null;

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

  if (sections.length === 0) {
    return (
      <div className="settings settings--empty">
        <p className="settings__empty">No settings available.</p>
      </div>
    );
  }

  return (
    <div className="settings">
      {error && <div className="settings__error">{error}</div>}

      <div className="settings__tabs" role="tablist" aria-label="Settings sections">
        {sections.map((section) => {
          const isActive = section.id === activeId;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`settings-panel-${section.id}`}
              id={`settings-tab-${section.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`settings__tab ${isActive ? 'settings__tab--active' : ''}`}
              onClick={() => setRequestedId(section.id)}
            >
              {section.title ?? section.id}
            </button>
          );
        })}
      </div>

      {activeSection && (
        <div
          className="settings__panel"
          role="tabpanel"
          id={`settings-panel-${activeSection.id}`}
          aria-labelledby={`settings-tab-${activeSection.id}`}
        >
          {activeSection.title && (
            <h3 className="settings__section-title">{activeSection.title}</h3>
          )}
          {activeSection.description && (
            <p className="settings__section-description">{activeSection.description}</p>
          )}

          <div className="settings__options">
            {activeSection.options.map((option) => (
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

          {activeSection.options.length === 0 && (
            <p className="settings__empty">No options in this section.</p>
          )}
        </div>
      )}

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
