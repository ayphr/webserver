import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultAssistantState,
  type AssistantChat,
  type AssistantMode,
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
  selectMode: (mode: AssistantMode) => void;
  createFolder: (name: string) => void;
  createChat: (folderId: string | null, mode: AssistantMode) => AssistantChat;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  reorderFolders: (fromId: string, toId: string) => void;
  reorderChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
  moveChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
  togglePinChat: (chatId: string) => void;
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

type Orderable = { order?: number; createdAt: number };

const compareOrder = (a: Orderable, b: Orderable) =>
  (a.order ?? 0) - (b.order ?? 0) || b.createdAt - a.createdAt;

const sortFolders = (folders: AssistantState['folders']) => [...folders].sort(compareOrder);

const sortDisplayChats = (chats: AssistantChat[]) =>
  [...chats].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compareOrder(a, b),
  );

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/**
 * Places a chat at a display index inside a folder group. Pinned chats always
 * occupy the front of a group, so the requested index is clamped to the
 * matching pinned/unpinned section before order values are reassigned.
 */
const placeChat = (
  current: AssistantState,
  chatId: string,
  folderId: string | null,
  targetIndex: number,
): AssistantState => {
  const chat = current.chats.find((item) => item.id === chatId);
  if (!chat) return current;

  const sourceFolderId = chat.folderId;
  const sourceList = sortDisplayChats(
    current.chats.filter((item) => item.folderId === sourceFolderId),
  );
  const targetList =
    sourceFolderId === folderId
      ? sourceList
      : sortDisplayChats(current.chats.filter((item) => item.folderId === folderId));
  const remaining =
    sourceFolderId === folderId ? targetList.filter((item) => item.id !== chatId) : targetList;
  const pinnedCount = remaining.filter((item) => item.pinned).length;
  const index = chat.pinned
    ? clamp(targetIndex, 0, pinnedCount)
    : clamp(targetIndex, pinnedCount, remaining.length);

  const finalList = [...remaining];
  finalList.splice(index, 0, { ...chat, folderId });
  const orders = new Map(finalList.map((item, position) => [item.id, position]));

  let chats = current.chats.map((item) => {
    const order = orders.get(item.id);
    if (order === undefined) return item;
    return item.id === chatId
      ? { ...item, folderId, order, updatedAt: Date.now() }
      : { ...item, order };
  });

  if (sourceFolderId !== folderId) {
    const sourceOrders = new Map(
      sourceList
        .filter((item) => item.id !== chatId)
        .map((item, position) => [item.id, position]),
    );
    chats = chats.map((item) => {
      const order = sourceOrders.get(item.id);
      return order === undefined ? item : { ...item, order };
    });
  }

  return { ...current, chats };
};

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

  const selectMode = useCallback(
    (mode: AssistantMode) => {
      update((current) => ({ ...current, activeMode: mode }));
    },
    [update],
  );

  const createFolder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder = { id: createId(), name: trimmed, createdAt: Date.now() };
      update((current) => {
        const minOrder = current.folders.reduce(
          (minimum, item) => Math.min(minimum, item.order ?? 0),
          0,
        );
        return {
          ...current,
          folders: [{ ...folder, order: minOrder - 1 }, ...current.folders],
          activeFolderId: folder.id,
        };
      });
    },
    [update],
  );

  const createChat = useCallback(
    (folderId: string | null, mode: AssistantMode) => {
      const now = Date.now();
      const group = sortDisplayChats(
        stateRef.current.chats.filter((item) => item.folderId === folderId),
      );
      const chat: AssistantChat = {
        id: createId(),
        title: mode === 'task' ? 'New task' : 'New chat',
        folderId,
        pinned: false,
        order: group.length,
        mode,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      update((current) => ({
        ...current,
        chats: [chat, ...current.chats],
        activeChatId: chat.id,
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

  const reorderFolders = useCallback(
    (fromId: string, toId: string) => {
      update((current) => {
        const ordered = sortFolders(current.folders);
        const fromIndex = ordered.findIndex((folder) => folder.id === fromId);
        const toIndex = ordered.findIndex((folder) => folder.id === toId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return current;

        const [moved] = ordered.splice(fromIndex, 1);
        ordered.splice(toIndex, 0, moved);
        const orders = new Map(ordered.map((folder, index) => [folder.id, index]));
        return {
          ...current,
          folders: current.folders.map((folder) => {
            const order = orders.get(folder.id);
            return order === undefined ? folder : { ...folder, order };
          }),
        };
      });
    },
    [update],
  );

  const reorderChat = useCallback(
    (chatId: string, folderId: string | null, targetIndex: number) => {
      update((current) => placeChat(current, chatId, folderId, targetIndex));
    },
    [update],
  );

  const moveChat = useCallback(
    (chatId: string, folderId: string | null, targetIndex: number) => {
      update((current) => placeChat(current, chatId, folderId, targetIndex));
    },
    [update],
  );

  const togglePinChat = useCallback(
    (chatId: string) => {
      update((current) => {
        const chat = current.chats.find((item) => item.id === chatId);
        if (!chat) return current;

        const pinned = !chat.pinned;
        const group = sortDisplayChats(
          current.chats.filter(
            (item) => item.folderId === chat.folderId && item.id !== chatId,
          ),
        );
        const pinnedCount = group.filter((item) => item.pinned).length;
        group.splice(pinned ? 0 : pinnedCount, 0, { ...chat, pinned });
        const orders = new Map(group.map((item, index) => [item.id, index]));
        return {
          ...current,
          chats: current.chats.map((item) => {
            const order = orders.get(item.id);
            if (order === undefined) return item;
            return item.id === chatId
              ? { ...item, pinned, order, updatedAt: Date.now() }
              : { ...item, order };
          }),
        };
      });
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
      selectMode,
      createFolder,
      createChat,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
      reorderFolders,
      reorderChat,
      moveChat,
      togglePinChat,
    }),
    [
      state,
      isLoading,
      update,
      updatePreferences,
      selectFolder,
      selectMode,
      createFolder,
      createChat,
      renameFolder,
      deleteFolder,
      renameChat,
      deleteChat,
      reorderFolders,
      reorderChat,
      moveChat,
      togglePinChat,
    ],
  );
};
