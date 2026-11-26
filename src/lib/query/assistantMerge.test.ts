import { describe, expect, test } from 'bun:test';
import type { AssistantState } from '@common';
import { mergeAssistantState } from './assistantMerge';

const baseState: AssistantState = {
  activeChatId: 'c1',
  activeFolderId: null,
  activeMode: 'chat',
  folders: [],
  chats: [{ id: 'c1', title: 'Draft', folderId: null, mode: 'chat', messages: [], createdAt: 1, updatedAt: 2 }],
  preferences: { defaultVariant: 'standard', sendShortcut: 'enter', permissionLevel: 'always-ask', notificationLevel: 'always', allowedTools: [], chatRetentionDays: 0, piiRedactionEnabled: true },
};

describe('mergeAssistantState', () => {
  test('local dirty chat wins over stale server refetch', () => {
    const local = baseState;
    const server: AssistantState = {
      ...baseState,
      chats: [{ ...baseState.chats[0], title: 'Old', updatedAt: 1 }],
    };

    const merged = mergeAssistantState(local, server, { dirtyChatIds: ['c1'] });
    expect(merged.chats[0].title).toBe('Draft');
  });

  test('server wins for clean chats', () => {
    const local = baseState;
    const server: AssistantState = { ...baseState, chats: [{ ...baseState.chats[0], title: 'Server', updatedAt: 3 }] };
    const merged = mergeAssistantState(local, server, { dirtyChatIds: [] });
    expect(merged.chats[0].title).toBe('Server');
  });
});
