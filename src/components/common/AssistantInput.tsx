import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconPlayerStop } from '@tabler/icons-react';
import { ASSISTANT_VARIANTS } from '@common';
import { AssistantDropdown } from './AssistantDropdown';
import type { AssistantVariant } from '@common';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
  username?: string;
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

type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
};

export const AssistantInput = ({
  placeholder = 'Ask Iris',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
  username,
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
  const [variant, setVariant] = useState<AssistantVariant>(fallbackVariant);
  const [multiline, setMultiline] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [subtitleIndex, setSubtitleIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setMultiline(nextHeight > 40);
  }, [value]);

  useEffect(() => {
    const id = setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % SUBTITLE_TEXTS.length);
    }, 4000);
    return () => clearInterval(id);
  }, [SUBTITLE_TEXTS.length]);

  const isChat = messages.length > 0;

  const stopGeneration = () => {
    if (abortRef.current) {
      clearTimeout(abortRef.current);
      abortRef.current = null;
    }
    setIsGenerating(false);
  };

  const handleSend = () => {
    if (isGenerating) {
      stopGeneration();
      return;
    }
    const currentValue = value.trim() ? value : (textareaRef.current?.value ?? '');
    const trimmed = currentValue.trim();
    if (!trimmed) return;

    const userMessage: Message = { id: nextIdRef.current++, role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setValue('');
    if (textareaRef.current) textareaRef.current.value = '';

    setIsGenerating(true);
    abortRef.current = setTimeout(() => {
      const assistantMessage: Message = {
        id: nextIdRef.current++,
        role: 'assistant',
        content: generateGibberish(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsGenerating(false);
      abortRef.current = null;
    }, 900 + Math.random() * 700);
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
                <div className="assistant-chat__bubble">{message.content}</div>
              </div>
            ))}
            {isGenerating && (
              <div className="assistant-chat__message assistant-chat__message--assistant">
                <div className="assistant-chat__bubble assistant-chat__bubble--typing">
                  <span className="assistant-chat__dot" />
                  <span className="assistant-chat__dot" />
                  <span className="assistant-chat__dot" />
                </div>
              </div>
            )}
          </div>
        )}
        <div
          className={`assistant-input__box ${multiline ? 'assistant-input__box--multiline' : ''}`}
        >
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
              className={`assistant-input__send ${variant === 'turbo' ? 'assistant-input__send--turbo' : ''} ${isGenerating ? 'assistant-input__send--stop' : ''}`}
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