import { useState } from 'react';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import './CopyableField.css';

export interface CopyableFieldProps {
  label?: string;
  value: string;
}

export const CopyableField = ({ label, value }: CopyableFieldProps) => {
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
    <div className="copyable-field">
      {label && <label className="copyable-field__label">{label}</label>}
      <div className="copyable-field__control">
        <div className="copyable-field__value" tabIndex={0} role="textbox" aria-readonly="true">
          {value}
        </div>
        <button
          type="button"
          className="copyable-field__copy"
          onClick={() => void handleCopy()}
          aria-label="Copy"
        >
          {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
        </button>
      </div>
    </div>
  );
};