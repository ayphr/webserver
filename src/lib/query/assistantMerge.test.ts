import { describe, expect, test } from 'bun:test';
import { mergeAssistantState } from './assistantMerge';

describe('mergeAssistantState', () => {
  test('local dirty chat wins over stale server refetch', () => {
    const local = {
      activeChatId: 'c1',
      activeFolderId: null,
      activeMode: 'chat',
      folders: [],
      chats: [{ id: 'c1', title: 'Draft', folderId: null, mode: 'chat', messages: [], createdAt: 1, updatedAt: 2 }],
      preferences: { defaultVariant: 'standard', sendShortcut: 'enter', permissionLevel: 'ask', notificationLevel: 'important', allowedTools: [], chatRetentionDays: 0, piiRedactionEnabled: true },
    } as any;
    const server = {
      ...local,
      chats: [{ ...local.chats[0], title: 'Old', updatedAt: 1 }],
    } as any;

    const merged = mergeAssistantState(local, server, { dirtyChatIds: ['c1'] });
    expect(merged.chats[0].title).toBe('Draft');
  });

  test('server wins for clean chats', () => {
    const local = {
      activeChatId: 'c1', activeFolderId: null, activeMode: 'chat', folders: [],
      chats: [{ id: 'c1', title: 'Local', folderId: null, mode: 'chat', messages: [], createdAt: 1, updatedAt: 2 }],
      preferences: { defaultVariant: 'standard', sendShortcut: 'enter', permissionLevel: 'ask', notificationLevel: 'important', allowedTools: [], chatRetentionDays: 0, piiRedactionEnabled: true },
    } as any;
    const server = { ...local, chats: [{ ...local.chats[0], title: 'Server', updatedAt: 3 }] } as any;
    const merged = mergeAssistantState(local, server, { dirtyChatIds: [] });
    expect(merged.chats[0].title).toBe('Server');
  });
});
