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

const emojiCache: { [key: string]: string } = {};

const createEmoji = (emoji: string): string => {
  if (emojiCache[emoji]) {
    return emojiCache[emoji];
  }
  // twemoji only replaces emoji and passes the rest of the string through, so the
  // text must be escaped before it is assigned via innerHTML.
  const parsed = twemoji.parse(escapeHtml(emoji), {
    folder: 'svg',
    ext: '.svg',
  });
  emojiCache[emoji] = parsed;
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
