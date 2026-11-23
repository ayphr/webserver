import { describe, expect, test } from 'bun:test';
import { createDefaultAssistantState, type AssistantMessage, type AssistantState } from '@common';
import { mergeStreamResults } from './assistant';
import type { StreamResultRecord } from './internal';

const assistantMessage = (id: number, content: string, createdAt = 2): AssistantMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt,
  variant: 'standard',
});

const userMessage = (id: number, content: string): AssistantMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 1,
});

const record = (chatId: string, messageId: number): StreamResultRecord => ({
  chatId,
  messageId,
  chatTitle: 'Server task',
  mode: 'task',
  userMessage: userMessage(messageId - 1, 'Do the task'),
  assistantMessage: assistantMessage(messageId, 'Server response'),
  createdAt: 1,
  updatedAt: 3,
});

describe('mergeStreamResults', () => {
  test('returns the original state when there are no server results', () => {
    const state = createDefaultAssistantState();
    expect(mergeStreamResults(state, {})).toBe(state);
    expect(mergeStreamResults(state, undefined)).toBe(state);
  });

  test('recreates a missing chat from the server result for deep links', () => {
    const state: AssistantState = createDefaultAssistantState();
    const merged = mergeStreamResults(state, { 'chat-1:2': record('chat-1', 2) });

    expect(merged.chats).toHaveLength(1);
    expect(merged.chats[0]).toMatchObject({
      id: 'chat-1',
      title: 'Server task',
      mode: 'task',
    });
    expect(merged.chats[0]?.messages.map((message) => message.content)).toEqual([
      'Do the task',
      'Server response',
    ]);
  });

  test('replaces a stale client placeholder while keeping client feedback', () => {
    const base = createDefaultAssistantState();
    const state: AssistantState = {
      ...base,
      chats: [
        {
          id: 'chat-1',
          title: 'Client title',
          folderId: null,
          mode: 'task',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            userMessage(1, 'Do the task')!,
            { ...assistantMessage(2, ''), error: 'Stream disconnected', feedback: 'like' },
          ],
        },
      ],
    };
    const merged = mergeStreamResults(state, { 'chat-1:2': record('chat-1', 2) });

    expect(merged.chats[0]).toMatchObject({ title: 'Client title', updatedAt: 3 });
    expect(merged.chats[0]?.messages[1]).toMatchObject({
      id: 2,
      content: 'Server response',
      feedback: 'like',
    });
    expect(merged.chats[0]?.messages[1]?.error).toBeUndefined();
  });

  test('does not resurrect messages explicitly removed by the client', () => {
    const base = createDefaultAssistantState();
    const state: AssistantState = {
      ...base,
      chats: [
        {
          id: 'chat-1',
          title: 'Server task',
          folderId: null,
          mode: 'task',
          createdAt: 1,
          updatedAt: 4,
          messages: [],
        },
      ],
    };
    const merged = mergeStreamResults(state, { 'chat-1:2': record('chat-1', 2) });

    expect(merged.chats[0]?.messages).toEqual([]);
  });

  test('keeps results from concurrent streams separately', () => {
    const state = createDefaultAssistantState();
    const merged = mergeStreamResults(state, {
      'chat-1:2': record('chat-1', 2),
      'chat-2:4': record('chat-2', 4),
    });

    expect(merged.chats).toHaveLength(2);
    expect(merged.chats.find((chat) => chat.id === 'chat-1')?.messages[1]?.content).toBe('Server response');
    expect(merged.chats.find((chat) => chat.id === 'chat-2')?.messages[1]?.content).toBe('Server response');
  });
});
