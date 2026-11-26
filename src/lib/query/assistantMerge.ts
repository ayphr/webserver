import type { AssistantState } from '@common';

export type AssistantDirtyMeta = {
  dirtyChatIds: string[];
  dirtyPreferences?: boolean;
  dirtyFolders?: boolean;
};

export function mergeAssistantState(
  local: AssistantState,
  server: AssistantState,
  dirty: AssistantDirtyMeta,
): AssistantState {
  const dirtyChatIds = new Set(dirty.dirtyChatIds);
  const serverChatsById = new Map(server.chats.map((c) => [c.id, c]));
  const localChatsById = new Map(local.chats.map((c) => [c.id, c]));

  const mergedChats = server.chats.map((serverChat) => {
    if (!dirtyChatIds.has(serverChat.id)) return serverChat;
    return localChatsById.get(serverChat.id) ?? serverChat;
  });

  for (const localChat of local.chats) {
    if (dirtyChatIds.has(localChat.id) && !serverChatsById.has(localChat.id)) {
      mergedChats.unshift(localChat);
    }
  }

  return {
    ...server,
    ...((dirty.dirtyPreferences || dirty.dirtyFolders) ? {
      preferences: dirty.dirtyPreferences ? local.preferences : server.preferences,
      folders: dirty.dirtyFolders ? local.folders : server.folders,
    } : {}),
    chats: mergedChats,
    // Keep local active selection when user has local state; avoids jarring jump.
    activeChatId: local.activeChatId ?? server.activeChatId,
    activeFolderId: local.activeFolderId ?? server.activeFolderId,
    activeMode: local.activeMode ?? server.activeMode,
  };
}
