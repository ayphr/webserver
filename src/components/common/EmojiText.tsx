import React, { useMemo } from 'react';
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

const toText = (children: React.ReactNode): string => {
  if (children === null || children === undefined || typeof children === 'boolean') {
    return '';
  }
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(toText).join('');
  }
  return '';
};

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
  const text = toText(children);
  const html = useMemo(() => createEmoji(text), [text]);

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};