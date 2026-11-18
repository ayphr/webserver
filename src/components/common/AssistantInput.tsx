import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconX } from '@tabler/icons-react';
import { ASSISTANT_VARIANTS } from '@common';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariant } from '@common';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
}

export const AssistantInput = ({
  placeholder = 'Ask the assistant anything...',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
}: AssistantInputProps) => {
  const [value, setValue] = useState('');
  const fallbackVariant = availableVariants.includes('standard')
    ? 'standard'
    : (availableVariants[0] ?? 'nano');
  const [variant, setVariant] = useState<AssistantVariant>(fallbackVariant);
  const [multiline, setMultiline] = useState(false);

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);
  const canUseTurbo = availableVariants.includes('turbo');
  const [turboNotice, setTurboNotice] = useState<'open' | 'closing' | 'closed'>(
    canUseTurbo ? 'open' : 'closed',
  );
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTurboNotice(canUseTurbo ? 'open' : 'closed');
  }, [canUseTurbo]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (variant === 'turbo' && turboNotice === 'open') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTurboNotice('closing');
      noticeTimerRef.current = setTimeout(() => setTurboNotice('closed'), 220);
    }
  }, [variant, turboNotice]);

  const closeTurboNotice = () => {
    if (turboNotice !== 'open') return;
    setTurboNotice('closing');
    noticeTimerRef.current = setTimeout(() => setTurboNotice('closed'), 220);
  };

  const handleVariantChange = (nextVariant: AssistantVariant) => {
    if (nextVariant === 'turbo' && turboNotice === 'open') {
      setTurboNotice('closing');
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setTurboNotice('closed'), 220);
    }
    setVariant(nextVariant);
  };

  const tryTurbo = () => handleVariantChange('turbo');

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
      <div className="assistant-input__stack">
        {turboNotice !== 'closed' && canUseTurbo && (
          <div
            className={`assistant-input__turbo-notice ${turboNotice === 'closing' ? 'assistant-input__turbo-notice--closing' : ''}`}
            role="status"
          >
            <button
              type="button"
              className="assistant-input__turbo-close"
              aria-label="Dismiss Turbo announcement"
              onClick={closeTurboNotice}
            >
              <IconX size={16} strokeWidth={2} />
            </button>
            <div className="assistant-input__turbo-copy">
              <strong>Turbo is now available</strong>
              <span>Turbo is for your hardest tasks which require the most powerful models</span>
            </div>
            <button
              type="button"
              className="assistant-input__turbo-try"
              onClick={tryTurbo}
            >
              Try it out
            </button>
          </div>
        )}
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
            <AssistantDropdown
              value={variant}
              onChange={handleVariantChange}
              availableVariants={availableVariants}
            />
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
    </div>
  );
};
