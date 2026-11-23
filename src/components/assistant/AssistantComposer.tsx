import { useEffect, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import {
  IconArrowUp,
  IconCommand,
  IconCornerDownLeft,
  IconKey,
  IconPlayerStop,
} from '@tabler/icons-react';
import type { AssistantSendShortcut, AssistantVariant } from '@common';
import { AssistantDropdown } from '../common';
import './AssistantComposer.css';

export interface AssistantComposerProps {
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  variant: AssistantVariant;
  onVariantChange: (variant: AssistantVariant) => void;
  availableVariants: AssistantVariant[];
  isChat: boolean;
  isGenerating: boolean;
  sendShortcut: AssistantSendShortcut;
  isMac: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  dataShared: boolean;
  onSend: () => void;
  onQueue: () => void;
}

export const AssistantComposer = ({
  placeholder = 'Ask Iris',
  value,
  onValueChange,
  variant,
  onVariantChange,
  availableVariants,
  isChat,
  isGenerating,
  sendShortcut,
  isMac,
  textareaRef,
  dataShared,
  onSend,
  onQueue,
}: AssistantComposerProps) => {
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
  }, [value, textareaRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onQueue();
      return;
    }
    const shouldSend = sendShortcut === 'enter' ? !e.shiftKey : e.shiftKey;
    if (!shouldSend) return;
    e.preventDefault();
    onSend();
  };

  return (
    <>
      <div className="assistant-input__box assistant-input__box--multiline">
        <textarea
          ref={textareaRef}
          className="assistant-input__textarea"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <div className="assistant-input__footer">
          <AssistantDropdown
            value={variant}
            onChange={onVariantChange}
            availableVariants={availableVariants}
          />
          {isChat && isGenerating && value.trim() && (
            <span
              className="assistant-input__queue-hint"
              title={isMac ? 'Queue with ⌘ + Enter' : 'Queue with Ctrl + Enter'}
            >
              <span className="sr-only">
                {isMac ? 'Queue with Command Enter' : 'Queue with Control Enter'}
              </span>
              {isMac ? (
                <IconCommand size={13} strokeWidth={1.75} />
              ) : (
                <IconKey size={13} strokeWidth={1.75} />
              )}
              <IconCornerDownLeft size={13} strokeWidth={1.75} />
            </span>
          )}
          <button
            type="button"
            className={`assistant-input__send ${isGenerating ? 'assistant-input__send--stop' : ''}`}
            aria-label={isGenerating ? 'Stop' : 'Send'}
            onClick={onSend}
          >
            {isGenerating ? (
              <IconPlayerStop size={16} strokeWidth={2} />
            ) : (
              <IconArrowUp size={18} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
      <p className="assistant-input__disclaimer">
        Iris is AI. By using it, you agree to our{' '}
        <Link to="/policies/terms">Terms</Link> &amp;{' '}
        <Link to="/policies/privacy">Privacy Policy</Link>.{' '}
        {dataShared
          ? 'Chats may be reviewed and used to improve our AI models and enforce the Terms.'
          : 'Chats may be reviewed to enforce the Terms.'}
      </p>
    </>
  );
};
