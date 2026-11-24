import type { AssistantMessage } from '@common';
import type { LiveAssistantMessage } from './types';

export const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const mergeById = <T extends { id: string }>(items: T[] | undefined, next: T): T[] => {
  const current = items ?? [];
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) return [...current, next];
  const updated = [...current];
  updated[index] = next;
  return updated;
};

export const toPersistableMessage = (message: LiveAssistantMessage): AssistantMessage => {
  const { liveDurationMs, liveTokensPerSecond, liveCreditCost, ...persistable } = message;
  void liveDurationMs;
  void liveTokensPerSecond;
  void liveCreditCost;
  return persistable;
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

export const TOOL_SLOT_PREFIX = 'assistant-tool-slot:';
export const TOOL_SLOT_PATTERN = /^\[\[assistant-tool-slot:([^\]]+)\]\]$/;
const FENCE_PATTERN = /^\s*(```+|~~~+)/;
const BLANK_LINE_PATTERN = /\n[ \t]*\n/g;

export interface ToolSlot {
  id: string;
  offset: number;
}

/**
 * Moves a tool offset forward to the end of the current markdown block. Slots
 * are injected as whole paragraphs, so fences and lists are never cut in half.
 */
const safeSlotOffset = (content: string, requested: number): number => {
  const length = content.length;
  let position = Math.max(0, Math.min(length, requested));
  const lines = content.split('\n');
  const lineStarts = lines.map((_, index) =>
    lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0),
  );

  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lineStarts[index]! > position) break;
    const match = FENCE_PATTERN.exec(lines[index] ?? '');
    if (fence === null) {
      if (match) fence = match[1] ?? '';
    } else if (match && fence && match[1]?.startsWith(fence)) {
      fence = null;
    }
  }

  if (fence !== null) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lineStarts[index]! < position) continue;
      const match = FENCE_PATTERN.exec(lines[index] ?? '');
      if (match && match[1]?.startsWith(fence)) {
        position = lineStarts[index]! + (lines[index] ?? '').length + 1;
        break;
      }
    }
  }

  BLANK_LINE_PATTERN.lastIndex = 0;
  let boundary: RegExpExecArray | null;
  while ((boundary = BLANK_LINE_PATTERN.exec(content)) !== null) {
    if (boundary.index + boundary[0].length >= position) {
      return boundary.index + boundary[0].length;
    }
  }
  return length;
};

/** Inserts tool placeholders once, in offset order, into the full markdown. */
export const buildToolSlotMarkdown = (content: string, slots: ToolSlot[]): string => {
  if (slots.length === 0) return content;
  const seen = new Set<string>();
  const ordered = slots
    .filter((slot) => {
      if (seen.has(slot.id) || !Number.isFinite(slot.offset)) return false;
      seen.add(slot.id);
      return true;
    })
    .sort((a, b) => a.offset - b.offset);

  let result = '';
  let cursor = 0;
  let previousAt = -1;
  for (const slot of ordered) {
    const at = Math.max(cursor, previousAt, safeSlotOffset(content, slot.offset));
    previousAt = at;
    result += `${content.slice(cursor, at)}\n\n[[${TOOL_SLOT_PREFIX}${slot.id}]]\n\n`;
    cursor = at;
  }
  if (cursor === content.length && result.endsWith('\n\n')) {
    result = result.slice(0, -2);
  }
  return `${result}${content.slice(cursor)}`;
};

export const createChatTitle = (text: string, fallback: string) => {
  const firstLine = text
    .trim()
    .split('\n')[0]
    ?.replace(/^[#>*\s-]+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
  if (!firstLine) return fallback;
  return firstLine.length > 42 ? `${firstLine.slice(0, 42).trimEnd()}…` : firstLine;
};
