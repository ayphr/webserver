import { useEffect, useRef, useState } from 'react';
import { IconArrowUp } from '@tabler/icons-react';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariant } from '@common';
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
  const [variant, setVariant] = useState<AssistantVariant>('standard');
  const [multiline, setMultiline] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const previousHeight = el.offsetHeight;
    el.style.transition = 'none';
    el.style.height = 'auto';
    const nextHeight = el.scrollHeight;
    el.style.height = `${previousHeight}px`;
    void el.offsetHeight;
    el.style.transition = 'height 0.2s ease';
    el.style.height = `${nextHeight}px`;
    setMultiline(nextHeight > 40);
  }, [value]);

  return (
    <div className={`assistant-input ${className}`}>
      <div className={`assistant-input__box ${multiline ? 'assistant-input__box--multiline' : ''}`}>
        <textarea
          ref={textareaRef}
          className="assistant-input__textarea"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={1}
        />
        <div className="assistant-input__footer">
          <AssistantDropdown value={variant} onChange={setVariant} />
          <button
            type="button"
            className="assistant-input__send"
            aria-label="Send"
          // Intentionally does nothing for now.
          >
            <IconArrowUp size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};
