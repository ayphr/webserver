import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
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
  IconX,
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
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { AssistantMarkdown } from './AssistantMarkdown';
import './AssistantMessages.css';

export interface AssistantMessagesProps {
  messages: LiveAssistantMessage[];
  queuedMessages: string[];
  streamingMessageId: number | null;
  followSignal: number;
  openMenuId: number | null;
  onOpenMenuChange: (id: number | null) => void;
  copiedId: number | null;
  fallbackVariant: AssistantVariant;
  onUndo: (messageId: number) => void;
  onFeedback: (messageId: number, feedback: 'like' | 'dislike') => void;
  onRegenerate: (messageId: number) => void;
  onCopy: (messageId: number, content: string) => void;
  onRemoveQueued: (index: number) => void;
  onMoveQueued: (index: number, direction: -1 | 1) => void;
  onJumpVisibilityChange: (visible: boolean) => void;
}

export interface AssistantMessagesHandle {
  jumpToLatest: () => void;
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
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // Collapse the trace when the answer finishes, like other chat clients.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(streaming);
    if (!streaming) {
      setShowHistory(false);
    }
  }, [streaming]);

  const completed = steps.filter((step) => step.status === 'done').length;
  const active = steps.find((step) => step.status === 'running');
  const reachedIndex = latestReachedIndex(steps);
  const activeStep = reachedIndex >= 0 ? steps[reachedIndex] : undefined;
  const earlierSteps = streaming ? steps.slice(0, reachedIndex) : [];
  const visibleSteps = streaming
    ? showHistory
      ? [...earlierSteps, ...(activeStep ? [activeStep] : [])]
      : activeStep
        ? [activeStep]
        : []
    : steps;
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
        {earlierSteps.length > 0 && (
          <button
            type="button"
            className="assistant-chat__history-toggle"
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
          >
            {showHistory
              ? 'Hide earlier steps'
              : `${earlierSteps.length} earlier ${earlierSteps.length === 1 ? 'step' : 'steps'}`}
          </button>
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
    {(tool.error || tool.detail) && (
      <span className="assistant-chat__tool-line-detail">{tool.error ?? tool.detail}</span>
    )}
  </div>
);

const ToolGroup = ({ tools, active }: { tools: AssistantToolCall[]; active: boolean }) => {
  const [open, setOpen] = useState(active);
  const [showHistory, setShowHistory] = useState(false);
  const reachedIndex = latestReachedIndex(tools);
  const latest = reachedIndex >= 0 ? tools[reachedIndex] : undefined;
  const reachedCount = reachedIndex + 1;

  useEffect(() => {
    // Keep the newest tool visible while calls are still arriving, then fold
    // the group away once the response finishes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(active);
    if (!active) {
      setShowHistory(false);
    }
  }, [active, reachedCount]);

  if (!latest) return null;

  const earlierTools = active ? tools.slice(0, reachedIndex) : [];

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
          {earlierTools.length > 0 && (
            <button
              type="button"
              className="assistant-chat__history-toggle"
              onClick={() => setShowHistory((value) => !value)}
              aria-expanded={showHistory}
            >
              {showHistory
                ? 'Hide earlier tools'
                : `${earlierTools.length} earlier ${earlierTools.length === 1 ? 'tool' : 'tools'}`}
            </button>
          )}
          {active ? (
            <>
              {showHistory &&
                earlierTools.map((tool) => <ToolCallLine key={tool.id} tool={tool} />)}
              <ToolCallLine key={latest.id} tool={latest} />
            </>
          ) : (
            tools.map((tool) => <ToolCallLine key={tool.id} tool={tool} />)
          )}
        </div>
      )}
    </div>
  );
};

export const AssistantMessages = forwardRef<AssistantMessagesHandle, AssistantMessagesProps>(
  function AssistantMessages(
    {
      messages,
      queuedMessages,
      streamingMessageId,
      followSignal,
      openMenuId,
      onOpenMenuChange,
      copiedId,
      fallbackVariant,
      onUndo,
      onFeedback,
      onRegenerate,
      onCopy,
      onRemoveQueued,
      onMoveQueued,
      onJumpVisibilityChange,
    },
    ref,
  ) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollbarTimeoutRef = useRef<number | null>(null);
  const jumpTimeoutRef = useRef<number | null>(null);
  const isJumpingRef = useRef(false);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  // Batch follow-along scrolling into one write per frame. Streaming tokens can
  // arrive faster than the browser paints, which otherwise makes the view jump.
  const scrollToBottom = useCallback(() => {
    scrollFrameRef.current = null;
    const element = containerRef.current;
    if (!element || !stickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
    onJumpVisibilityChange(false);
  }, [onJumpVisibilityChange]);

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => scrollToBottom());
  }, [scrollToBottom]);

  // Only follow new output while the user is at the bottom. A small tolerance
  // keeps programmatic scrolls from turning off follow-along, while any real
  // scroll away from the bottom hands control back to the user.
  const handleScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom <= 24) {
      stickToBottomRef.current = true;
      onJumpVisibilityChange(false);
    } else if (!isJumpingRef.current) {
      stickToBottomRef.current = false;
      onJumpVisibilityChange(distanceFromBottom > 160);
    }

    element.classList.add('assistant-chat__messages--scrolling');
    if (scrollbarTimeoutRef.current !== null) window.clearTimeout(scrollbarTimeoutRef.current);
    scrollbarTimeoutRef.current = window.setTimeout(() => {
      element.classList.remove('assistant-chat__messages--scrolling');
      scrollbarTimeoutRef.current = null;
    }, 700);
  };

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      if (scrollbarTimeoutRef.current !== null) window.clearTimeout(scrollbarTimeoutRef.current);
      if (jumpTimeoutRef.current !== null) window.clearTimeout(jumpTimeoutRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    scheduleScrollToBottom();
  }, [messages, queuedMessages, streamingMessageId, scheduleScrollToBottom]);

  // Markdown, thinking panels and tool groups can change height after a token
  // lands. Keep following as the inner content grows.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    stickToBottomRef.current = true;
    scheduleScrollToBottom();
  }, [followSignal, scheduleScrollToBottom]);

  const jumpToLatest = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    stickToBottomRef.current = true;
    isJumpingRef.current = true;
    onJumpVisibilityChange(false);
    if (jumpTimeoutRef.current !== null) window.clearTimeout(jumpTimeoutRef.current);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
    if (prefersReducedMotion) {
      isJumpingRef.current = false;
      return;
    }
    jumpTimeoutRef.current = window.setTimeout(() => {
      isJumpingRef.current = false;
      jumpTimeoutRef.current = null;
      const current = containerRef.current;
      if (!current) return;
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
      stickToBottomRef.current = distance <= 24;
      onJumpVisibilityChange(distance > 160);
    }, 600);
  }, [onJumpVisibilityChange, prefersReducedMotion]);

  useImperativeHandle(ref, () => ({ jumpToLatest }), [jumpToLatest]);

  const lastMenuIdRef = useRef<number | null>(null);
  const closeMenu = useCallback(() => onOpenMenuChange(null), [onOpenMenuChange]);

  useEffect(() => {
    if (openMenuId !== null) {
      lastMenuIdRef.current = openMenuId;
      return;
    }
    if (lastMenuIdRef.current !== null) {
      menuTriggerRef.current?.focus();
      lastMenuIdRef.current = null;
    }
  }, [openMenuId]);

  useDismiss(null, closeMenu, {
    enabled: openMenuId !== null,
    escape: true,
    isInside: (target) => {
      const menu = document.querySelector('.assistant-chat__menu');
      const chevron = menuTriggerRef.current;
      return Boolean(menu?.contains(target) || chevron?.contains(target));
    },
  });

  useLayoutEffect(() => {
    if (openMenuId === null) return;
    const container = containerRef.current;
    const trigger = container?.querySelector<HTMLElement>(`[data-menu-id="${openMenuId}"]`);
    menuTriggerRef.current = trigger ?? null;
    const place = () => {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = 180;
      const estimatedHeight = 140;
      const top =
        rect.bottom + estimatedHeight + 8 > window.innerHeight
          ? Math.max(8, rect.top - estimatedHeight - 8)
          : rect.bottom + 6;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setMenuPosition({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    container?.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      container?.removeEventListener('scroll', place);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (openMenuId === null) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.assistant-chat__menu-item')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openMenuId]);

  return (
    <div className="assistant-chat__viewport">
      <div
        className="assistant-chat__messages"
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-busy={streamingMessageId !== null}
      >
        <div className="assistant-chat__messages-inner" ref={innerRef}>
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
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === message.id}
                  >
                    <IconChevronDown size={14} strokeWidth={2} />
                  </button>
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
                    {message.content ? (
                      <AssistantMarkdown content={message.content} />
                    ) : (
                      isStreaming && (
                        <span className="assistant-chat__pending" role="status">
                          Working…
                        </span>
                      )
                    )}
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
                      disabled={isStreaming}
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
                      disabled={isStreaming}
                    >
                      {message.feedback === 'dislike' ? (
                        <IconThumbDownFilled size={15} strokeWidth={1.75} />
                      ) : (
                        <IconThumbDown size={15} strokeWidth={1.75} />
                      )}
                    </button>
                    {isLatestAssistant && !isStreaming && (
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
                <div className="assistant-chat__queued-row">
                  <span className="assistant-chat__queued-label">Queued</span>
                  <div className="assistant-chat__queued-actions">
                    <button
                      type="button"
                      onClick={() => onMoveQueued(index, -1)}
                      disabled={index === 0}
                      aria-label="Move queued message earlier"
                    >
                      <IconArrowUp size={12} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveQueued(index, 1)}
                      disabled={index === queuedMessages.length - 1}
                      aria-label="Move queued message later"
                    >
                      <IconArrowDown size={12} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveQueued(index)}
                      aria-label="Remove queued message"
                    >
                      <IconX size={12} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {openMenuId !== null &&
        (() => {
          const menuMessage = messages.find((message) => message.id === openMenuId);
          if (!menuMessage) return null;
          return createPortal(
            <div
              className="assistant-chat__menu assistant-chat__menu--portal"
              style={{
                top: menuPosition?.top ?? -9999,
                left: menuPosition?.left ?? -9999,
              }}
              role="menu"
            >
              <div className="assistant-chat__menu-time">
                {formatMessageTime(menuMessage.createdAt)}
              </div>
              <button
                type="button"
                role="menuitem"
                className="assistant-chat__menu-item"
                onClick={() => {
                  onUndo(menuMessage.id);
                  closeMenu();
                }}
              >
                <IconArrowBackUp size={14} strokeWidth={2} />
                <span>Undo</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="assistant-chat__menu-item"
                onClick={() => {
                  void onCopy(menuMessage.id, menuMessage.content);
                  closeMenu();
                }}
              >
                <IconCopy size={14} strokeWidth={2} />
                <span>Copy message</span>
              </button>
            </div>,
            document.body,
          );
        })()}
    </div>
  );
  },
);
