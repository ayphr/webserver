import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconPlayerStop, IconChevronDown, IconArrowBackUp, IconCopy } from '@tabler/icons-react';
import { ASSISTANT_VARIANTS } from '@common';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariant } from '@common';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
  username?: string;
  defaultVariant?: AssistantVariant;
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
};

export const AssistantInput = ({
  placeholder = 'Ask Iris',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
  username,
  defaultVariant,
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTokensRef = useRef<string[]>([]);
  const streamIndexRef = useRef(0);
  const streamMessageIdRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);

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

  const stopGeneration = () => {
    if (streamRef.current) {
      clearTimeout(streamRef.current);
      streamRef.current = null;
    }
    streamTokensRef.current = [];
    streamIndexRef.current = 0;
    streamMessageIdRef.current = null;
    setIsGenerating(false);
  };

  const startStreaming = (messageId: number, text: string) => {
    const tokens = text.split(' ');
    streamTokensRef.current = tokens;
    streamIndexRef.current = 0;
    streamMessageIdRef.current = messageId;
    setIsGenerating(true);

    const tick = () => {
      if (streamIndexRef.current >= streamTokensRef.current.length) {
        streamRef.current = null;
        streamTokensRef.current = [];
        streamIndexRef.current = 0;
        streamMessageIdRef.current = null;
        setIsGenerating(false);
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
      { id: assistantId, role: 'assistant', content: '', createdAt: now },
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
                  <div className="assistant-chat__bubble">
                    {message.content.split(' ').filter(Boolean).map((word, i) => (
                      <span key={i} className="assistant-chat__token">
                        {word}{' '}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isChat && (
          <button
            type="button"
            className="assistant-chat__back"
            onClick={() => {
              stopGeneration();
              setMessages([]);
            }}
          >
            Back to home
          </button>
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
        </div>
      </div>
    </div>
  );
};