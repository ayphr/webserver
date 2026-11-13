import { useState } from 'react';
import { IconSend } from '@tabler/icons-react';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariants } from '@common';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
}

export const AssistantInput = ({
  placeholder = 'Ask the assistant anything...',
  className = '',
}: AssistantInputProps) => {
  const [value, setValue] = useState('');
  const [variant, setVariant] = useState<AssistantVariants>('standard');

  return (
    <div className={`assistant-input ${className}`}>
      <div className="assistant-input__box">
        <textarea
          className="assistant-input__textarea"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
        />
        <div className="assistant-input__footer">
          <AssistantDropdown value={variant} onChange={setVariant} />
          <button
            type="button"
            className="assistant-input__send"
            aria-label="Send"
            // Intentionally does nothing for now.
          >
            <IconSend size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};
