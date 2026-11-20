import type { AssistantMessage } from '@common';
import type { LiveAssistantMessage } from './types';

export const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const toPersistableMessage = (message: LiveAssistantMessage): AssistantMessage => {
  const { liveDurationMs, liveTokensPerSecond, ...persistable } = message;
  void liveDurationMs;
  void liveTokensPerSecond;
  return persistable;
};

const GIBBERISH_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
];

export const generateGibberish = () => {
  const length = (8 + Math.floor(Math.random() * 12)) * 5;
  const words: string[] = [];
  for (let i = 0; i < length; i++) {
    words.push(GIBBERISH_WORDS[Math.floor(Math.random() * GIBBERISH_WORDS.length)]);
  }
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
};

export const formatMessageTime = (timestamp: number) => {
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

export const formatDuration = (ms?: number) => {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};
