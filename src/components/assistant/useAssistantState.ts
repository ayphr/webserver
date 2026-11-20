import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultAssistantState,
  type AssistantPreferences,
  type AssistantState,
} from '@common';
import { api } from '../../lib/api';
import { createId, toPersistableMessage } from './utils';

export type AssistantController = {
  state: AssistantState;
  preferences: AssistantPreferences;
  isLoading: boolean;
  update: (updater: (current: AssistantState) => AssistantState) => void;
  updatePreferences: (patch: Partial<AssistantPreferences>) => void;
  selectFolder: (folderId: string | null) => void;
  createFolder: (name: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
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
  const stateRef = useRef(state);
  const pendingRef = useRef<AssistantState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async (next: AssistantState) => {
    try {
      await api.assistant.saveState(toPersistableState(next));
    } catch {
      // Assistant state is best-effort; keep the in-memory state usable.
    }
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void persist(pending);
  }, [persist]);

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

  const createFolder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder = { id: createId(), name: trimmed, createdAt: Date.now() };
      update((current) => ({
        ...current,
        folders: [folder, ...current.folders],
        activeFolderId: folder.id,
      }));
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
        chats: current.chats.map((chat) =>
          chat.folderId === id ? { ...chat, folderId: null, updatedAt: Date.now() } : chat,
        ),
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

  useEffect(() => {
    for (const key of LEGACY_ASSISTANT_STORAGE_KEYS) localStorage.removeItem(key);

    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await api.assistant.getState();
        if (cancelled || pendingRef.current) return;
        stateRef.current = loaded;
        setState(loaded);
      } catch {
        // Fall back to empty assistant state when the API is unavailable.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      flush();
    };
  }, [flush]);

  useEffect(() => {
    const handlePageHide = () => flush();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [flush]);

  return useMemo(
    () => ({
      state,
      preferences: state.preferences,
      isLoading,
      update,
      updatePreferences,
      selectFolder,
      createFolder,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
    }),
    [
      state,
      isLoading,
      update,
      updatePreferences,
      selectFolder,
      createFolder,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
    ],
  );
};
