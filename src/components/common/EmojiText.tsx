import React, { useEffect, useRef } from 'react';
import twemoji from '@twemoji/api';

interface EmojiTextProps {
  className?: string;
  children: React.ReactNode;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

const EMOJI_CACHE_MAX_ENTRIES = 200;
const emojiCache = new Map<string, string>();

const createEmoji = (emoji: string): string => {
  const cached = emojiCache.get(emoji);
  if (cached !== undefined) {
    return cached;
  }

  const parsed = twemoji.parse(escapeHtml(emoji), {
    folder: 'svg',
    ext: '.svg',
  });

  if (emojiCache.size >= EMOJI_CACHE_MAX_ENTRIES) {
    const oldest = emojiCache.keys().next().value;
    if (oldest !== undefined) emojiCache.delete(oldest);
  }
  emojiCache.set(emoji, parsed);

  return parsed;
};

export const EmojiText: React.FC<EmojiTextProps> = ({ className, children }) => {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (spanRef.current) {
      const emojiStr = typeof children === 'string' ? children : '';
      const emojiHTML = createEmoji(emojiStr);
      spanRef.current.innerHTML = emojiHTML;
    }
  }, [children]);

  return <span ref={spanRef} className={className}></span>;
};
