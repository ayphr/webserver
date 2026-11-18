import { useEffect, useRef, useState } from 'react';
import { IconArrowUp } from '@tabler/icons-react';
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

const PLACEHOLDER_TEXTS = [
  'Ask the assistant anything...',
  'What should we explore today?',
  'Need help with your data?',
  'Let’s build something great.',
  'Ask a question to get started.',
  'How can I assist you?',
  'What’s on your mind?',
  'Ready when you are.',
  'Let’s tackle a hard problem.',
  'Type your request here.',
  'What would you like to know?',
  'Help me understand your data.',
  'Let’s analyze something.',
  'Got a question? Ask away.',
  'What are we working on?',
  'Need insights? Just ask.',
  'Let’s dig into the details.',
  'What can I help you with?',
  'Start typing to begin.',
  'Your assistant is ready.',
  'Let’s make sense of it all.',
  'Ask about trends, devices, or credits.',
  'What’s the next step?',
  'Let’s find the answer.',
  'How can I support you today?',
];

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
  ];

  const [value, setValue] = useState('');
  const fallbackVariant = availableVariants.includes('standard')
    ? 'standard'
    : (availableVariants[0] ?? 'nano');
  const [variant, setVariant] = useState<AssistantVariant>(fallbackVariant);
  const [multiline, setMultiline] = useState(false);

  const [animatedPlaceholder, setAnimatedPlaceholder] = useState(PLACEHOLDER_TEXTS[0]);
  const [subtitleIndex, setSubtitleIndex] = useState(0);

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Animated placeholder: delete then type.
  useEffect(() => {
    if (placeholder) return; // disable animation if explicit placeholder provided
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    const run = async () => {
      let index = 0;
      while (!cancelled) {
        const current = PLACEHOLDER_TEXTS[index % PLACEHOLDER_TEXTS.length];
        setAnimatedPlaceholder(current);
        await wait(2200);
        if (cancelled) break;
        // delete characters one by one
        for (let i = current.length; i >= 0; i--) {
          if (cancelled) break;
          setAnimatedPlaceholder(current.slice(0, i));
          await wait(45);
        }
        if (cancelled) break;
        index = (index + 1) % PLACEHOLDER_TEXTS.length;
        const next = PLACEHOLDER_TEXTS[index];
        // type characters one by one
        for (let i = 1; i <= next.length; i++) {
          if (cancelled) break;
          setAnimatedPlaceholder(next.slice(0, i));
          await wait(65);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [placeholder]);

  // Rotating subtitle.
  useEffect(() => {
    const id = setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % SUBTITLE_TEXTS.length);
    }, 4000);
    return () => clearInterval(id);
  }, [SUBTITLE_TEXTS.length]);

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
        <p key={subtitleIndex} className="assistant-input__subtitle">{SUBTITLE_TEXTS[subtitleIndex]}</p>
        <div className={`assistant-input__box ${multiline ? 'assistant-input__box--multiline' : ''} ${variant === 'turbo' ? 'assistant-input__box--turbo' : ''}`}>
          <textarea
            ref={textareaRef}
            className="assistant-input__textarea"
            placeholder={placeholder ?? animatedPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={1}
          />
          <div className="assistant-input__footer">
            <AssistantDropdown
              value={variant}
              onChange={setVariant}
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
