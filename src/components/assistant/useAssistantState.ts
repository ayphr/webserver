import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const LEGACY_ASSISTANT_STORAGE_KEYS = [
  'ayphr-assistant-folders',
  'ayphr-assistant-chats',
  'ayphr-assistant-active-chat',
  'ayphr-assistant-active-folder',
  'ayphr-pref-assistant-variant',
  'ayphr-pref-assistant-send-shortcut',
];

const toPersistableState = (state: AssistantState): AssistantState => ({
  ...state,
  chats: state.chats.map((chat) => ({
    ...chat,
    messages: chat.messages.map(toPersistableMessage),
  })),
});

export const useAssistantState = (): AssistantController => {
  const [state, setState] = useState<AssistantState>(createDefaultAssistantState);
  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<AssistantSyncStatus>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const pendingRef = useRef<AssistantState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);

  const persist = useCallback(function persist(next: AssistantState): Promise<void> {
    const generation = ++saveGenerationRef.current;
    setSyncStatus('saving');
    setSyncError(null);
    // Serialize saves so a slow request cannot overwrite a newer state.
    const operation = saveQueueRef.current.then(async () => {
      try {
        await api.assistant.saveState(toPersistableState(next));
        if (generation === saveGenerationRef.current) {
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
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    return pending ? persist(pending) : Promise.resolve();
  }, [persist]);

  const loadState = useCallback(async function loadState(
    isRetry = false,
    force = false,
  ): Promise<AssistantState> {
    const generation = ++loadGenerationRef.current;
    if (!isRetry) setIsLoading(true);
    try {
      const loaded = await api.assistant.getState();
      if (generation !== loadGenerationRef.current || (!force && pendingRef.current)) {
        return stateRef.current;
      }
      stateRef.current = loaded;
      setState(loaded);
      setSyncStatus('saved');
      setSyncError(null);
      retryRef.current = null;
      return loaded;
    } catch (err) {
      if (generation !== loadGenerationRef.current) return stateRef.current;
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Failed to load assistant data');
      retryRef.current = () => {
        // Unsaved local changes take priority over re-fetching the old state.
        if (pendingRef.current) void flush();
        else void loadState(true);
      };
      return stateRef.current;
    } finally {
      if (generation === loadGenerationRef.current && !isRetry) setIsLoading(false);
    }
  }, [flush]);

  const refresh = useCallback(async (): Promise<AssistantState> => {
    await flush();
    return loadState(true, true);
  }, [flush, loadState]);

  const retrySync = useCallback(() => {
    const retry = retryRef.current;
    retryRef.current = null;
    retry?.();
  }, []);

  const update = useCallback(
    (updater: (current: AssistantState) => AssistantState) => {
      const next = updater(stateRef.current);
      stateRef.current = next;
      setState(next);
      pendingRef.current = next;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) void persist(pending);
      }, SAVE_DELAY_MS);
    },
    [persist],
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

  const deleteChat = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        chats: current.chats.filter((chat) => chat.id !== id),
        activeChatId: current.activeChatId === id ? null : current.activeChatId,
      }));
    },
    [update],
  );

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
    for (const key of LEGACY_ASSISTANT_STORAGE_KEYS) localStorage.removeItem(key);

    void loadState();
    return () => {
      loadGenerationRef.current += 1;
      void flush();
    };
  }, [flush, loadState]);

  useEffect(() => {
    const handlePageHide = () => void flush();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flush]);

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
