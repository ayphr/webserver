import { useEffect, useRef, useState } from 'react';
import {
  IconArrowBackUp,
  IconChevronDown,
  IconCopy,
  IconCopyCheck,
  IconDatabase,
  IconFileText,
  IconRefresh,
  IconSearch,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
  IconTool,
  IconWand,
} from '@tabler/icons-react';
import {
  ASSISTANT_DATA,
  type AssistantThinkingStep,
  type AssistantToolCall,
  type AssistantVariant,
} from '@common';
import type { LiveAssistantMessage } from './types';
import { formatDuration, formatMessageTime } from './utils';
import { useDismiss } from '../../hooks/useDismiss';
import { AssistantMarkdown } from './AssistantMarkdown';
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

const latestReachedIndex = <T extends { status: string }>(items: T[]) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.status !== 'pending') return index;
  }
  return -1;
};

const ThinkingPanel = ({
  steps,
  streaming,
}: {
  steps: AssistantThinkingStep[];
  streaming: boolean;
}) => {
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    // Collapse the trace when the answer finishes, like other chat clients.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(streaming);
  }, [streaming]);

  const completed = steps.filter((step) => step.status === 'done').length;
  const active = steps.find((step) => step.status === 'running');
  const reachedIndex = latestReachedIndex(steps);
  const activeStep = reachedIndex >= 0 ? steps[reachedIndex] : undefined;
  const visibleSteps = streaming ? (activeStep ? [activeStep] : []) : steps;
  const earlierCount = streaming && reachedIndex > 0 ? reachedIndex : 0;
  const settled = !active && reachedIndex === steps.length - 1;

  return (
    <details
      className="assistant-chat__thinking"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="assistant-chat__disclosure-summary">
        <span className="assistant-chat__disclosure-label">
          {active ? active.label : settled ? 'Thought for a moment' : 'Thinking'}
        </span>
        <span className="assistant-chat__disclosure-meta">
          {completed === steps.length ? `${steps.length} steps` : `${completed} of ${steps.length}`}
        </span>
        <IconChevronDown
          size={13}
          strokeWidth={2}
          className={`assistant-chat__disclosure-chevron${open ? ' assistant-chat__disclosure-chevron--open' : ''}`}
        />
      </summary>
      <div className="assistant-chat__thinking-steps">
        {earlierCount > 0 && (
          <div className="assistant-chat__thinking-earlier">
            {earlierCount} earlier {earlierCount === 1 ? 'step' : 'steps'}
          </div>
        )}
        {visibleSteps.map((step) => (
          <div
            key={step.id}
            className={`assistant-chat__thinking-step assistant-chat__thinking-step--${step.status}`}
          >
            <div className="assistant-chat__thinking-copy">
              <span className="assistant-chat__thinking-label">{step.label}</span>
              {step.detail && (
                <span className="assistant-chat__thinking-detail">{step.detail}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
};

const TOOL_ICON_PROPS = {
  size: 13,
  strokeWidth: 1.8,
  className: 'assistant-chat__tool-line-icon',
  'aria-hidden': true,
} as const;

const renderToolIcon = (name: string) => {
  if (name.includes('search')) return <IconSearch {...TOOL_ICON_PROPS} />;
  if (name.includes('query') || name.includes('data')) return <IconDatabase {...TOOL_ICON_PROPS} />;
  if (name.includes('docs') || name.includes('lookup')) return <IconFileText {...TOOL_ICON_PROPS} />;
  if (name.includes('format')) return <IconWand {...TOOL_ICON_PROPS} />;
  return <IconTool {...TOOL_ICON_PROPS} />;
};

const ToolCallLine = ({ tool }: { tool: AssistantToolCall }) => (
  <div className={`assistant-chat__tool-line assistant-chat__tool-line--${tool.status}`}>
    {renderToolIcon(tool.name)}
    <span className="assistant-chat__tool-line-label">{tool.label ?? tool.name}</span>
  </div>
);

const ToolGroup = ({ tools, active }: { tools: AssistantToolCall[]; active: boolean }) => {
  const [open, setOpen] = useState(active);
  const reachedIndex = latestReachedIndex(tools);
  const latest = reachedIndex >= 0 ? tools[reachedIndex] : undefined;
  const reachedCount = reachedIndex + 1;

  useEffect(() => {
    // Keep the newest tool visible while calls are still arriving, then fold
    // the group away once the response finishes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(active);
  }, [active, reachedCount]);

  if (!latest) return null;

  const earlierCount = reachedIndex;

  return (
    <div className="assistant-chat__tool-group">
      <button
        type="button"
        className="assistant-chat__disclosure-summary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="assistant-chat__disclosure-label">
          {reachedCount === 1 ? 'Used 1 tool' : `Used ${reachedCount} tools`}
        </span>
        {active && <span className="assistant-chat__disclosure-meta">working</span>}
        <IconChevronDown
          size={13}
          strokeWidth={2}
          className={`assistant-chat__disclosure-chevron${open ? ' assistant-chat__disclosure-chevron--open' : ''}`}
        />
      </button>
      {open && (
        <div className="assistant-chat__tool-group-items">
          {active && earlierCount > 0 && (
            <div className="assistant-chat__tool-group-earlier">
              {earlierCount} earlier {earlierCount === 1 ? 'tool' : 'tools'}
            </div>
          )}
          {active ? (
            <ToolCallLine key={latest.id} tool={latest} />
          ) : (
            tools.map((tool) => <ToolCallLine key={tool.id} tool={tool} />)
          )}
        </div>
      )}
    </div>
  );
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
}: AssistantMessagesProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useDismiss(null, () => onOpenMenuChange(null), {
    enabled: openMenuId !== null,
    escape: false,
    isInside: (target) => {
      const menu = containerRef.current?.querySelector('.assistant-chat__menu');
      if (!menu) return true;
      const chevron = containerRef.current?.querySelector(`[data-menu-id="${openMenuId}"]`);
      return menu.contains(target) || Boolean(chevron?.contains(target));
    },
  });

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
            ? message.content.split(/\s+/).filter(Boolean).length / (message.durationMs / 1000)
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
                {message.thinking && message.thinking.length > 0 && (
                  <ThinkingPanel steps={message.thinking} streaming={isStreaming} />
                )}
                {message.tools && message.tools.length > 0 && (
                  <ToolGroup tools={message.tools} active={isStreaming} />
                )}
                <div className="assistant-chat__bubble">
                  <AssistantMarkdown content={message.content} />
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
