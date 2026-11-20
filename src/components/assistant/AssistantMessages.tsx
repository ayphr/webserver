import { useEffect, useRef } from 'react';
import {
  IconArrowBackUp,
  IconChevronDown,
  IconCopy,
  IconCopyCheck,
  IconRefresh,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from '@tabler/icons-react';
import { ASSISTANT_DATA, type AssistantVariant } from '@common';
import type { LiveAssistantMessage } from './types';
import { formatDuration, formatMessageTime } from './utils';
import './AssistantMessages.css';

export interface AssistantMessagesProps {
  messages: LiveAssistantMessage[];
  queuedMessages: string[];
  streamingMessageId: number | null;
  openMenuId: number | null;
  onOpenMenuChange: (id: number | null) => void;
  copiedId: number | null;
  fallbackVariant: AssistantVariant;
  onUndo: (messageId: number) => void;
  onFeedback: (messageId: number, feedback: 'like' | 'dislike') => void;
  onRegenerate: (messageId: number) => void;
  onCopy: (messageId: number, content: string) => void;
}

export const AssistantMessages = ({
  messages,
  queuedMessages,
  streamingMessageId,
  openMenuId,
  onOpenMenuChange,
  copiedId,
  fallbackVariant,
  onUndo,
  onFeedback,
  onRegenerate,
  onCopy,
}: AssistantMessagesProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const menu = containerRef.current?.querySelector('.assistant-chat__menu');
      const chevron = containerRef.current?.querySelector(`[data-menu-id="${openMenuId}"]`);
      if (menu && !menu.contains(target) && !(chevron && chevron.contains(target))) {
        onOpenMenuChange(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId, onOpenMenuChange]);

  return (
    <div className="assistant-chat__messages" ref={containerRef}>
      {messages.map((message) => {
        const isStreaming = streamingMessageId === message.id;
        const isLatestAssistant =
          message.role === 'assistant' && messages[messages.length - 1]?.id === message.id;
        const displayedDurationMs = isStreaming ? message.liveDurationMs : message.durationMs;
        const tokensPerSecond = isStreaming
          ? message.liveTokensPerSecond
          : message.durationMs
            ? message.content.split(' ').filter(Boolean).length / (message.durationMs / 1000)
            : undefined;

        return (
          <div
            key={message.id}
            className={`assistant-chat__message assistant-chat__message--${message.role}`}
          >
            {message.role === 'user' ? (
              <div className="assistant-chat__user-wrap">
                <div className="assistant-chat__bubble">{message.content}</div>
                <button
                  type="button"
                  data-menu-id={message.id}
                  className={`assistant-chat__chevron ${openMenuId === message.id ? 'assistant-chat__chevron--open' : ''}`}
                  onClick={() => onOpenMenuChange(openMenuId === message.id ? null : message.id)}
                  aria-label="Message options"
                >
                  <IconChevronDown size={14} strokeWidth={2} />
                </button>
                {openMenuId === message.id && (
                  <div className="assistant-chat__menu">
                    <div className="assistant-chat__menu-time">
                      {formatMessageTime(message.createdAt)}
                    </div>
                    <button
                      type="button"
                      className="assistant-chat__menu-item"
                      onClick={() => onUndo(message.id)}
                    >
                      <IconArrowBackUp size={14} strokeWidth={2} />
                      <span>Undo</span>
                    </button>
                    <button
                      type="button"
                      className="assistant-chat__menu-item"
                      onClick={() => {
                        void onCopy(message.id, message.content);
                        onOpenMenuChange(null);
                      }}
                    >
                      <IconCopy size={14} strokeWidth={2} />
                      <span>Copy message</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="assistant-chat__assistant-wrap">
                <div className="assistant-chat__bubble">
                  {message.content.split(' ').filter(Boolean).map((word, i) => (
                    <span key={i} className="assistant-chat__token">
                      {word}{' '}
                    </span>
                  ))}
                </div>
                {message.error && <p className="assistant-chat__error">{message.error}</p>}
                {message.interrupted && (
                  <p className="assistant-chat__interrupted">You interrupted this response.</p>
                )}
                <div className="assistant-chat__toolbar">
                  <button
                    type="button"
                    className={`assistant-chat__tool ${message.feedback === 'like' ? 'assistant-chat__tool--active' : ''}`}
                    onClick={() => onFeedback(message.id, 'like')}
                    aria-label="Like response"
                    aria-pressed={message.feedback === 'like'}
                  >
                    {message.feedback === 'like' ? (
                      <IconThumbUpFilled size={15} strokeWidth={1.75} />
                    ) : (
                      <IconThumbUp size={15} strokeWidth={1.75} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`assistant-chat__tool ${message.feedback === 'dislike' ? 'assistant-chat__tool--active' : ''}`}
                    onClick={() => onFeedback(message.id, 'dislike')}
                    aria-label="Dislike response"
                    aria-pressed={message.feedback === 'dislike'}
                  >
                    {message.feedback === 'dislike' ? (
                      <IconThumbDownFilled size={15} strokeWidth={1.75} />
                    ) : (
                      <IconThumbDown size={15} strokeWidth={1.75} />
                    )}
                  </button>
                  {isLatestAssistant && (
                    <button
                      type="button"
                      className="assistant-chat__tool"
                      onClick={() => onRegenerate(message.id)}
                      aria-label="Regenerate response"
                    >
                      <IconRefresh size={15} strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`assistant-chat__tool assistant-chat__tool--copy ${copiedId === message.id ? 'assistant-chat__tool--copied' : ''}`}
                    onClick={() => onCopy(message.id, message.content)}
                    aria-label={copiedId === message.id ? 'Copied' : 'Copy response'}
                  >
                    <span className="assistant-chat__copy-icons">
                      <IconCopy size={15} strokeWidth={1.75} className="assistant-chat__copy-icon" />
                      <IconCopyCheck size={15} strokeWidth={1.75} className="assistant-chat__copied-icon" />
                    </span>
                  </button>
                  <span className="assistant-chat__meta">
                    <span>{ASSISTANT_DATA[message.variant ?? fallbackVariant].variantLabel}</span>
                    <span>{formatDuration(displayedDurationMs)}</span>
                    <span>
                      {tokensPerSecond == null
                        ? '— tok/s'
                        : `${tokensPerSecond.toFixed(1)} tok/s`}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {queuedMessages.map((text, index) => (
        <div
          key={`queued-${index}`}
          className="assistant-chat__message assistant-chat__message--user assistant-chat__message--queued"
        >
          <div className="assistant-chat__user-wrap">
            <div className="assistant-chat__bubble">{text}</div>
            <span className="assistant-chat__queued-label">Queued</span>
          </div>
        </div>
      ))}
    </div>
  );
};
