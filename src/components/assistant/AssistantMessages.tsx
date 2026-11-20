import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
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
  onRetry: (messageId: number) => void;
}

const getNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (isValidElement(node)) {
    return getNodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
};

const MarkdownCodeBlock = ({ children }: { children?: ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = getNodeText(children);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be unavailable; ignore.
    }
  };

  return (
    <div className="assistant-chat__code-block">
      <button
        type="button"
        className={`assistant-chat__code-copy ${copied ? 'assistant-chat__code-copy--copied' : ''}`}
        onClick={() => void handleCopy()}
        aria-label={copied ? 'Code copied' : 'Copy code'}
      >
        <span className="assistant-chat__code-copy-icons">
          <IconCopy size={13} strokeWidth={1.75} className="assistant-chat__code-copy-icon" />
          <IconCopyCheck size={13} strokeWidth={1.75} className="assistant-chat__code-copied-icon" />
        </span>
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre>{children}</pre>
    </div>
  );
};

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
};

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
  onRetry,
}: AssistantMessagesProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuButtonRefs = useRef(new Map<number, HTMLButtonElement>());

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

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, messageId: number) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onOpenMenuChange(null);
    menuButtonRefs.current.get(messageId)?.focus();
  };

  return (
    <div
      className="assistant-chat__messages"
      ref={containerRef}
      aria-busy={streamingMessageId !== null}
    >
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
        const thinking = message.thinking ?? [];
        const tools = message.tools ?? [];

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
                  ref={(element) => {
                    if (element) menuButtonRefs.current.set(message.id, element);
                    else menuButtonRefs.current.delete(message.id);
                  }}
                  className={`assistant-chat__chevron ${openMenuId === message.id ? 'assistant-chat__chevron--open' : ''}`}
                  onClick={() => onOpenMenuChange(openMenuId === message.id ? null : message.id)}
                  aria-label="Message options"
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === message.id}
                >
                  <IconChevronDown size={14} strokeWidth={2} />
                </button>
                {openMenuId === message.id && (
                  <div
                    className="assistant-chat__menu"
                    role="menu"
                    aria-label="Message options"
                    onKeyDown={(event) => handleMenuKeyDown(event, message.id)}
                  >
                    <div className="assistant-chat__menu-time">
                      {formatMessageTime(message.createdAt)}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="assistant-chat__menu-item"
                      onClick={() => onUndo(message.id)}
                    >
                      <IconArrowBackUp size={14} strokeWidth={2} />
                      <span>Undo</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
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
                {(thinking.length > 0 || tools.length > 0) && (
                  <div className="assistant-chat__activity">
                    {thinking.length > 0 && (
                      <details className="assistant-chat__thinking" open={isStreaming}>
                        <summary>
                          <IconChevronDown
                            size={13}
                            strokeWidth={2}
                            className="assistant-chat__activity-chevron"
                          />
                          <span>Thinking</span>
                          <span className="assistant-chat__activity-count">{thinking.length}</span>
                        </summary>
                        <ol className="assistant-chat__thinking-list">
                          {thinking.map((step) => (
                            <li
                              key={step.id}
                              className={`assistant-chat__activity-item assistant-chat__activity-item--${step.status}`}
                            >
                              <span className="assistant-chat__status-dot" aria-hidden="true" />
                              <span className="assistant-chat__activity-title">{step.title}</span>
                              <span className="assistant-chat__status-label">{step.status}</span>
                              {step.detail && (
                                <span className="assistant-chat__activity-detail">
                                  {step.detail}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    {tools.length > 0 && (
                      <ul className="assistant-chat__tool-list" aria-label="Tools used">
                        {tools.map((tool) => (
                          <li
                            key={tool.id}
                            className={`assistant-chat__activity-item assistant-chat__tool-card assistant-chat__activity-item--${tool.status}`}
                          >
                            <span className="assistant-chat__status-dot" aria-hidden="true" />
                            <span className="assistant-chat__activity-title">{tool.name}</span>
                            <span className="assistant-chat__status-label">{tool.status}</span>
                            {tool.durationMs != null && (
                              <span className="assistant-chat__activity-duration">
                                {formatDuration(tool.durationMs)}
                              </span>
                            )}
                            {tool.detail && (
                              <span className="assistant-chat__activity-detail">
                                {tool.detail}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="assistant-chat__bubble">
                  {isStreaming ? (
                    message.content.split(' ').filter(Boolean).map((word, i) => (
                      <span key={i} className="assistant-chat__token">
                        {word}{' '}
                      </span>
                    ))
                  ) : (
                    <div className="assistant-chat__markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                {message.error && (
                  <div className="assistant-chat__error-wrap" role="alert">
                    <p className="assistant-chat__error">{message.error}</p>
                    <button
                      type="button"
                      className="assistant-chat__retry"
                      onClick={() => onRetry(message.id)}
                      aria-label="Retry response"
                    >
                      <IconRefresh size={13} strokeWidth={1.75} />
                      <span>Retry</span>
                    </button>
                  </div>
                )}
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
