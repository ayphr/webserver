import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconArrowUp,
  IconPlayerStop,
  IconChevronDown,
  IconArrowBackUp,
  IconHome,
  IconCopy,
  IconCopyCheck,
  IconThumbUp,
  IconThumbUpFilled,
  IconThumbDown,
  IconThumbDownFilled,
  IconRefresh,
} from '@tabler/icons-react';
import { ASSISTANT_DATA, ASSISTANT_VARIANTS } from '@common';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariant } from '@common';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
  username?: string;
  defaultVariant?: AssistantVariant;
  dataShared?: boolean;
}

const GIBBERISH_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
];

const generateGibberish = () => {
  const length = 8 + Math.floor(Math.random() * 12);
  const words: string[] = [];
  for (let i = 0; i < length; i++) {
    words.push(GIBBERISH_WORDS[Math.floor(Math.random() * GIBBERISH_WORDS.length)]);
  }
  // Capitalize first word and add punctuation.
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
};

const formatMessageTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '');
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return `Yesterday, ${time}`;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  if (date.getFullYear() === now.getFullYear()) {
    return `${day}/${month} ${time}`;
  }
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year} ${time}`;
};

type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
  feedback?: 'like' | 'dislike' | null;
  variant?: AssistantVariant;
  durationMs?: number;
};

const formatDuration = (ms?: number) => {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

export const AssistantInput = ({
  placeholder = 'Ask Iris',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
  username,
  defaultVariant,
  dataShared = true,
}: AssistantInputProps) => {
  const displayName = username?.trim() || 'there';
  const SUBTITLE_TEXTS = [
    `What should we tackle, ${displayName}?`,
    'How can I help?',
    'Ready when you are.',
    'Let’s get to work.',
    'Ask me anything.',
    'What’s the plan today?',
    'Let’s make progress.',
    'How can I support you?',
    'What are we solving?',
    'Let’s get started.',
    'What’s on your agenda?',
    'Need a hand with something?',
    'Let’s dive in.',
    'What would you like to explore?',
    'Let’s turn data into answers.',
    'What can Iris do for you?',
    'Where should we begin?',
    'Let’s make today productive.',
    'What’s the next big question?',
    'I’m here to help.',
    'Let’s uncover some insights.',
    'What would you like to learn?',
    'Ready to explore your data?',
    'Let’s get things done.',
    'What’s on your mind?',
    'How can Iris assist?',
    'Let’s find the answer together.',
    'What should we focus on?',
    'Let’s take a look.',
    'What’s the challenge today?',
    'Let’s get to the bottom of it.',
    'How can I make things easier?',
    'What are we curious about?',
    'Let’s start something new.',
  ];

  const [value, setValue] = useState('');
  const fallbackVariant = availableVariants.includes('standard')
    ? 'standard'
    : (availableVariants[0] ?? 'nano');
  const initialVariant =
    defaultVariant && availableVariants.includes(defaultVariant) ? defaultVariant : fallbackVariant;
  const [variant, setVariant] = useState<AssistantVariant>(initialVariant);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTokensRef = useRef<string[]>([]);
  const streamIndexRef = useRef(0);
  const streamMessageIdRef = useRef<number | null>(null);
  const streamStartRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    [],
  );

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
  }, [value]);

  useEffect(() => {
    const id = setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % SUBTITLE_TEXTS.length);
    }, 4000);
    return () => clearInterval(id);
  }, [SUBTITLE_TEXTS.length]);

  useEffect(() => {
    if (openMenuId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const menu = document.querySelector('.assistant-chat__menu');
      const chevron = document.querySelector(`[data-menu-id="${openMenuId}"]`);
      if (menu && !menu.contains(target) && !(chevron && chevron.contains(target))) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  const isChat = messages.length > 0;

  const takeStreamDuration = () => {
    const started = streamStartRef.current;
    streamStartRef.current = null;
    return started === null ? undefined : Math.max(1, Date.now() - started);
  };

  const cancelStream = () => {
    if (streamRef.current) {
      clearTimeout(streamRef.current);
      streamRef.current = null;
    }
    streamTokensRef.current = [];
    streamIndexRef.current = 0;
    streamMessageIdRef.current = null;
    streamStartRef.current = null;
    setIsGenerating(false);
  };

  const stopGeneration = () => {
    const messageId = streamMessageIdRef.current;
    const durationMs = takeStreamDuration();
    cancelStream();
    if (messageId !== null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === 'assistant'
            ? { ...m, interrupted: true, durationMs: m.durationMs ?? durationMs }
            : m,
        ),
      );
    }
  };

  const handleFeedback = (messageId: number, feedback: 'like' | 'dislike') => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? { ...m, feedback: m.feedback === feedback ? null : feedback }
          : m,
      ),
    );
  };

  const handleRegenerate = (messageId: number) => {
    cancelStream();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? { ...m, content: '', interrupted: false, feedback: null, durationMs: undefined, variant }
          : m,
      ),
    );
    startStreaming(messageId, generateGibberish());
  };

  const copyMessage = async (messageId: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopiedId(messageId);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard access can be unavailable; ignore.
    }
  };

  const startStreaming = (messageId: number, text: string) => {
    const tokens = text.split(' ');
    streamTokensRef.current = tokens;
    streamIndexRef.current = 0;
    streamMessageIdRef.current = messageId;
    streamStartRef.current = Date.now();
    setIsGenerating(true);

    const tick = () => {
      if (streamIndexRef.current >= streamTokensRef.current.length) {
        const durationMs = takeStreamDuration();
        streamRef.current = null;
        streamTokensRef.current = [];
        streamIndexRef.current = 0;
        streamMessageIdRef.current = null;
        setIsGenerating(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.role === 'assistant'
              ? { ...m, durationMs: m.durationMs ?? durationMs }
              : m,
          ),
        );
        return;
      }
      streamIndexRef.current += 1;
      const partial = streamTokensRef.current.slice(0, streamIndexRef.current).join(' ');
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: partial } : m)),
      );
      streamRef.current = setTimeout(tick, 70 + Math.random() * 50);
    };
    streamRef.current = setTimeout(tick, 300);
  };

  const handleSend = () => {
    if (isGenerating) {
      stopGeneration();
      return;
    }
    const currentValue = value.trim() ? value : (textareaRef.current?.value ?? '');
    const trimmed = currentValue.trim();
    if (!trimmed) return;

    const now = Date.now();
    const userMessage: Message = { id: nextIdRef.current++, role: 'user', content: trimmed, createdAt: now };
    const assistantId = nextIdRef.current++;
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        interrupted: false,
        feedback: null,
        variant,
      },
    ]);
    setValue('');
    if (textareaRef.current) textareaRef.current.value = '';

    startStreaming(assistantId, generateGibberish());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`assistant-input ${isChat ? 'assistant-input--chat' : ''} ${className}`}>
      <div className="assistant-input__stack">
        {!isChat && (
          <p key={subtitleIndex} className="assistant-input__subtitle">
            {SUBTITLE_TEXTS[subtitleIndex]}
          </p>
        )}
        {isChat && (
          <div className="assistant-chat__messages">
            {messages.map((message) => (
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
                      onClick={() =>
                        setOpenMenuId((prev) => (prev === message.id ? null : message.id))
                      }
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
                          onClick={() => {
                            // Undo: remove this user message and the following assistant message.
                            setMessages((prev) => {
                              const index = prev.findIndex((m) => m.id === message.id);
                              if (index === -1) return prev;
                              const next = [...prev];
                              // remove user message
                              next.splice(index, 1);
                              // remove following assistant message if present
                              if (index < next.length && next[index]?.role === 'assistant') {
                                next.splice(index, 1);
                              }
                              return next;
                            });
                            setOpenMenuId(null);
                          }}
                        >
                          <IconArrowBackUp size={14} strokeWidth={2} />
                          <span>Undo</span>
                        </button>
                        <button
                          type="button"
                          className="assistant-chat__menu-item"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(message.content);
                            } catch {
                              // ignore
                            }
                            setOpenMenuId(null);
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
                    {message.interrupted && (
                      <p className="assistant-chat__interrupted">You interrupted this response.</p>
                    )}
                    <div className="assistant-chat__toolbar">
                      <button
                        type="button"
                        className={`assistant-chat__tool ${message.feedback === 'like' ? 'assistant-chat__tool--active' : ''}`}
                        onClick={() => handleFeedback(message.id, 'like')}
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
                        onClick={() => handleFeedback(message.id, 'dislike')}
                        aria-label="Dislike response"
                        aria-pressed={message.feedback === 'dislike'}
                      >
                        {message.feedback === 'dislike' ? (
                          <IconThumbDownFilled size={15} strokeWidth={1.75} />
                        ) : (
                          <IconThumbDown size={15} strokeWidth={1.75} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="assistant-chat__tool"
                        onClick={() => handleRegenerate(message.id)}
                        aria-label="Regenerate response"
                      >
                        <IconRefresh size={15} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className={`assistant-chat__tool assistant-chat__tool--copy ${copiedId === message.id ? 'assistant-chat__tool--copied' : ''}`}
                        onClick={() => copyMessage(message.id, message.content)}
                        aria-label={copiedId === message.id ? 'Copied' : 'Copy response'}
                      >
                        <span className="assistant-chat__copy-icons">
                          <IconCopy size={15} strokeWidth={1.75} className="assistant-chat__copy-icon" />
                          <IconCopyCheck size={15} strokeWidth={1.75} className="assistant-chat__copied-icon" />
                        </span>
                      </button>
                      <span className="assistant-chat__meta">
                        <span>{ASSISTANT_DATA[message.variant ?? variant].variantLabel}</span>
                        <span>{formatDuration(message.durationMs)}</span>
                        <span>
                          {message.durationMs
                            ? `${(message.content.split(' ').filter(Boolean).length / (message.durationMs / 1000)).toFixed(1)} tok/s`
                            : '— tok/s'}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="assistant-input__box assistant-input__box--multiline">
          <textarea
            ref={textareaRef}
            className="assistant-input__textarea"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isGenerating}
          />
          <div className="assistant-input__footer">
            {isChat && (
              <button
                type="button"
                className="assistant-input__back"
                onClick={() => {
                  stopGeneration();
                  setMessages([]);
                }}
                aria-label="Back to home"
              >
                <IconHome size={17} strokeWidth={1.75} />
              </button>
            )}
            <AssistantDropdown
              value={variant}
              onChange={setVariant}
              availableVariants={availableVariants}
            />
            <button
              type="button"
              className={`assistant-input__send ${isGenerating ? 'assistant-input__send--stop' : ''}`}
              aria-label={isGenerating ? 'Stop' : 'Send'}
              onClick={handleSend}
            >
              {isGenerating ? (
                <IconPlayerStop size={16} strokeWidth={2} />
              ) : (
                <IconArrowUp size={18} strokeWidth={2} />
              )}
            </button>
          </div>
          <p className="assistant-input__disclaimer">
            Iris is AI. By using it, you agree to our{' '}
            <Link to="/policies/terms">Terms</Link> &amp;{' '}
            <Link to="/policies/privacy">Privacy Policy</Link>.{' '}
            {dataShared
              ? 'Chats may be reviewed and used to improve our AI models and enforce the Terms.'
              : 'Chats may be reviewed to enforce the Terms.'}
          </p>
        </div>
      </div>
    </div>
  );
};