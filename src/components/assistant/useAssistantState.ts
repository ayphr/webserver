import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDefaultAssistantState,
  moveAssistantChatsToFolder,
  placeAssistantChat,
  prependAssistantChat,
  reorderAssistantFolders,
  type AssistantChat,
  type AssistantMode,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantPreferences,
  type AssistantState,
} from '@common';
import { api } from '../../lib/api';
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from '../../lib/storage';
import { queryKeys } from '../../lib/query';
import { mergeAssistantState, type AssistantDirtyMeta } from '../../lib/query/assistantMerge';
import { createId, toPersistableMessage } from './utils';

export type AssistantSyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AssistantController = {
  state: AssistantState;
  preferences: AssistantPreferences;
  isLoading: boolean;
  syncStatus: AssistantSyncStatus;
  syncError: string | null;
  retrySync: () => void;
  /** Flush local saves and reload the authoritative state from the server. */
  refresh: () => Promise<AssistantState>;
  update: (updater: (current: AssistantState) => AssistantState) => void;
  updatePreferences: (patch: Partial<AssistantPreferences>) => void;
  selectFolder: (folderId: string | null) => void;
  selectMode: (mode: AssistantMode) => void;
  selectPermissionLevel: (level: AssistantPermissionLevel) => void;
  selectNotificationLevel: (level: AssistantNotificationLevel) => void;
  allowTool: (name: string) => void;
  createFolder: (name: string) => void;
  createChat: (folderId: string | null, mode: AssistantMode) => AssistantChat;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  reorderFolders: (fromId: string, toId: string) => void;
  reorderChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
  moveChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
};

const SAVE_DELAY_MS = 500;
const ASSISTANT_DIRTY_KEY = 'ayphr-assistant-dirty-v1';

const LEGACY_ASSISTANT_STORAGE_KEYS = [
  STORAGE_KEYS.assistantFolders,
  STORAGE_KEYS.assistantChats,
  STORAGE_KEYS.assistantActiveChat,
  STORAGE_KEYS.assistantActiveFolder,
  STORAGE_KEYS.assistantVariant,
  STORAGE_KEYS.assistantSendShortcut,
];

const toPersistableState = (state: AssistantState): AssistantState => ({
  ...state,
  chats: state.chats.map((chat) => ({
    ...chat,
    messages: chat.messages.map(toPersistableMessage),
  })),
});

function readDirtyMeta(): AssistantDirtyMeta {
  try {
    const raw = readStorage(ASSISTANT_DIRTY_KEY, 'local');
    if (!raw) return { dirtyChatIds: [] };
    const parsed = JSON.parse(raw) as AssistantDirtyMeta;
    return { dirtyChatIds: Array.isArray(parsed.dirtyChatIds) ? parsed.dirtyChatIds : [], dirtyPreferences: !!parsed.dirtyPreferences, dirtyFolders: !!parsed.dirtyFolders };
  } catch {
    return { dirtyChatIds: [] };
  }
}

function writeDirtyMeta(meta: AssistantDirtyMeta) {
  if (!meta.dirtyChatIds.length && !meta.dirtyPreferences && !meta.dirtyFolders) {
    removeStorage(ASSISTANT_DIRTY_KEY, 'local');
    return;
  }
  writeStorage(ASSISTANT_DIRTY_KEY, JSON.stringify(meta), 'local');
}

export const useAssistantState = (): AssistantController => {
  const queryClient = useQueryClient();
  const assistantQuery = useQuery({
    queryKey: queryKeys.assistantState(),
    queryFn: () => api.assistant.getState(),
    staleTime: 30_000,
  });

  const cached = queryClient.getQueryData<AssistantState>(queryKeys.assistantState()) ?? assistantQuery.data ?? createDefaultAssistantState();
  const [state, setState] = useState<AssistantState>(cached);
  const [syncStatus, setSyncStatus] = useState<AssistantSyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const pendingRef = useRef<AssistantState | null>(null);
  const dirtyMetaRef = useRef<AssistantDirtyMeta>(readDirtyMeta());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const incoming = assistantQuery.data;
    if (!incoming) return;
    const dirty = dirtyMetaRef.current;
    const hasDirty = dirty.dirtyChatIds.length > 0 || !!dirty.dirtyPreferences || !!dirty.dirtyFolders || !!pendingRef.current;
    const next = hasDirty ? mergeAssistantState(stateRef.current, incoming, dirty) : incoming;
    if (JSON.stringify(next) !== JSON.stringify(stateRef.current)) {
      stateRef.current = next;
      setState(next);
      queryClient.setQueryData(queryKeys.assistantState(), next);
    }
  }, [assistantQuery.data, queryClient]);

  const persist = useCallback(function persist(next: AssistantState): Promise<void> {
    const generation = ++saveGenerationRef.current;
    setSyncStatus('saving');
    setSyncError(null);
    const operation = saveQueueRef.current.then(async () => {
      try {
        const saved = await api.assistant.saveState(toPersistableState(next));
        if (generation === saveGenerationRef.current) {
          dirtyMetaRef.current = { dirtyChatIds: [] };
          writeDirtyMeta(dirtyMetaRef.current);
          pendingRef.current = null;
          const merged = mergeAssistantState(stateRef.current, saved, dirtyMetaRef.current);
          stateRef.current = merged;
          setState(merged);
          queryClient.setQueryData(queryKeys.assistantState(), merged);
          setSyncStatus('saved');
          setSyncError(null);
          retryRef.current = null;
        }
      } catch (err) {
        if (generation === saveGenerationRef.current) {
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : 'Failed to save assistant data');
          retryRef.current = () => persist(next);
        }
      }
    });
    saveQueueRef.current = operation;
    return operation;
  }, [queryClient]);

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    return pending ? persist(pending) : Promise.resolve();
  }, [persist]);

  const refresh = useCallback(async (): Promise<AssistantState> => {
    await flush();
    const res = await queryClient.fetchQuery({ queryKey: queryKeys.assistantState(), queryFn: () => api.assistant.getState(), staleTime: 0 });
    const dirty = dirtyMetaRef.current;
    const hasDirty = dirty.dirtyChatIds.length > 0 || !!dirty.dirtyPreferences || !!dirty.dirtyFolders;
    const merged = hasDirty ? mergeAssistantState(stateRef.current, res, dirty) : res;
    stateRef.current = merged;
    setState(merged);
    queryClient.setQueryData(queryKeys.assistantState(), merged);
    return merged;
  }, [flush, queryClient]);

  const retrySync = useCallback(() => {
    const retry = retryRef.current;
    retryRef.current = null;
    if (retry) retry();
    else if (pendingRef.current) void flush();
  }, [flush]);

  const markDirty = useCallback((prev: AssistantState, next: AssistantState) => {
    const dirty = dirtyMetaRef.current;
    const dirtyChatIds = new Set(dirty.dirtyChatIds);
    const prevChats = new Map(prev.chats.map((c) => [c.id, c]));
    for (const chat of next.chats) {
      if (JSON.stringify(prevChats.get(chat.id)) !== JSON.stringify(chat)) dirtyChatIds.add(chat.id);
    }
    for (const id of prevChats.keys()) {
      if (!next.chats.some((c) => c.id === id)) dirtyChatIds.add(id);
    }
    dirtyMetaRef.current = {
      dirtyChatIds: Array.from(dirtyChatIds),
      dirtyPreferences: dirty.dirtyPreferences || JSON.stringify(prev.preferences) !== JSON.stringify(next.preferences),
      dirtyFolders: dirty.dirtyFolders || JSON.stringify(prev.folders) !== JSON.stringify(next.folders),
    };
    writeDirtyMeta(dirtyMetaRef.current);
  }, []);

  const update = useCallback(
    (updater: (current: AssistantState) => AssistantState) => {
      const prev = stateRef.current;
      const next = updater(prev);
      markDirty(prev, next);
      stateRef.current = next;
      setState(next);
      queryClient.setQueryData(queryKeys.assistantState(), next);
      pendingRef.current = next;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void persist(pending);
      }, SAVE_DELAY_MS);
    },
    [markDirty, persist, queryClient],
  );

  const updatePreferences = useCallback(
    (patch: Partial<AssistantPreferences>) => {
      update((current) => ({
        ...current,
        preferences: { ...current.preferences, ...patch },
      }));
    },
    [update],
  );

  const selectFolder = useCallback(
    (folderId: string | null) => {
      update((current) => ({ ...current, activeFolderId: folderId }));
    },
    [update],
  );

  const selectMode = useCallback(
    (mode: AssistantMode) => {
      update((current) => ({ ...current, activeMode: mode }));
    },
    [update],
  );

  const selectPermissionLevel = useCallback(
    (level: AssistantPermissionLevel) => {
      updatePreferences({ permissionLevel: level });
    },
    [updatePreferences],
  );

  const selectNotificationLevel = useCallback(
    (level: AssistantNotificationLevel) => {
      updatePreferences({ notificationLevel: level });
    },
    [updatePreferences],
  );

  const allowTool = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      update((current) =>
        current.preferences.allowedTools.includes(trimmed)
          ? current
          : {
              ...current,
              preferences: {
                ...current.preferences,
                allowedTools: [...current.preferences.allowedTools, trimmed],
              },
            },
      );
    },
    [update],
  );

  const createFolder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder = { id: createId(), name: trimmed, createdAt: Date.now() };
      update((current) => {
        const firstOrder = current.folders.reduce(
          (minimum, item) => Math.min(minimum, item.order ?? 0),
          0,
        );
        return {
          ...current,
          folders: [{ ...folder, order: firstOrder - 1 }, ...current.folders],
          activeFolderId: folder.id,
        };
      });
    },
    [update],
  );

  const createChat = useCallback(
    (folderId: string | null, mode: AssistantMode) => {
      const now = Date.now();
      const chat: AssistantChat = {
        id: createId(),
        title: mode === 'task' ? 'New task' : 'New chat',
        folderId,
        mode,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      update((current) => ({
        ...current,
        chats: prependAssistantChat(current.chats, chat),
        activeChatId: chat.id,
        activeMode: mode,
      }));
      return chat;
    },
    [update],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      update((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === id ? { ...folder, name: trimmed } : folder,
        ),
      }));
    },
    [update],
  );

  const deleteFolder = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        folders: current.folders.filter((folder) => folder.id !== id),
        chats: moveAssistantChatsToFolder(current.chats, id, null),
        activeFolderId: current.activeFolderId === id ? null : current.activeFolderId,
      }));
    },
    [update],
  );

  const renameChat = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      update((current) => ({
        ...current,
        chats: current.chats.map((chat) =>
          chat.id === id ? { ...chat, title: trimmed, updatedAt: Date.now() } : chat,
        ),
      }));
    },
    [update],
  );

  const deleteChatRef = useRef<(id: string) => void>(() => {});

  const deleteChat = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        chats: current.chats.filter((chat) => chat.id !== id),
        activeChatId: current.activeChatId === id ? null : current.activeChatId,
      }));

      const previousQueue = saveQueueRef.current;
      const operation = (async () => {
        try {
          await previousQueue;
          if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending) {
            setSyncStatus('saving');
            await api.assistant.saveState(toPersistableState(pending));
          }
          setSyncStatus('saving');
          const saved = await api.assistant.deleteChat(id);
          dirtyMetaRef.current = { dirtyChatIds: dirtyMetaRef.current.dirtyChatIds.filter((cid) => cid !== id), dirtyPreferences: dirtyMetaRef.current.dirtyPreferences, dirtyFolders: dirtyMetaRef.current.dirtyFolders };
          writeDirtyMeta(dirtyMetaRef.current);
          const merged = mergeAssistantState(stateRef.current, saved, dirtyMetaRef.current);
          stateRef.current = merged;
          setState(merged);
          queryClient.setQueryData(queryKeys.assistantState(), merged);
          setSyncStatus('saved');
          setSyncError(null);
          retryRef.current = null;
        } catch (err) {
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : 'Failed to delete assistant chat');
          retryRef.current = () => deleteChatRef.current(id);
        }
      })();

      saveQueueRef.current = operation;
    },
    [queryClient, update],
  );

  deleteChatRef.current = deleteChat;

  const reorderFolders = useCallback(
    (fromId: string, toId: string) => {
      update((current) => {
        const folders = reorderAssistantFolders(current.folders, fromId, toId);
        return folders === current.folders ? current : { ...current, folders };
      });
    },
    [update],
  );

  const reorderChat = useCallback(
    (chatId: string, folderId: string | null, targetIndex: number) => {
      update((current) => {
        const chats = placeAssistantChat(current.chats, chatId, folderId, targetIndex);
        return chats === current.chats ? current : { ...current, chats };
      });
    },
    [update],
  );

  const moveChat = useCallback(
    (chatId: string, folderId: string | null, targetIndex: number) => {
      update((current) => {
        const chats = placeAssistantChat(current.chats, chatId, folderId, targetIndex);
        return chats === current.chats ? current : { ...current, chats };
      });
    },
    [update],
  );

  useEffect(() => {
    for (const key of LEGACY_ASSISTANT_STORAGE_KEYS) removeStorage(key, 'local');
    return () => { void flush(); };
  }, [flush]);

  useEffect(() => {
    const handlePageHide = () => void flush();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flush]);

  const isLoading = !assistantQuery.data && assistantQuery.isPending;

  return useMemo(
    () => ({
      state,
      preferences: state.preferences,
      isLoading,
      syncStatus,
      syncError,
      retrySync,
      refresh,
      update,
      updatePreferences,
      selectFolder,
      selectMode,
      selectPermissionLevel,
      selectNotificationLevel,
      allowTool,
      createFolder,
      createChat,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
      reorderFolders,
      reorderChat,
      moveChat,
    }),
    [
      state,
      isLoading,
      syncStatus,
      syncError,
      retrySync,
      refresh,
      update,
      updatePreferences,
      selectFolder,
      selectMode,
      selectPermissionLevel,
      selectNotificationLevel,
      allowTool,
      createFolder,
      createChat,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
      reorderFolders,
      reorderChat,
      moveChat,
    ],
  );
};
