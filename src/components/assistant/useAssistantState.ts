import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultAssistantState,
  type AssistantPreferences,
  type AssistantState,
} from '@common';
import { api } from '../../lib/api';
import { toPersistableMessage } from './utils';

export type AssistantController = {
  state: AssistantState;
  preferences: AssistantPreferences;
  isLoading: boolean;
  update: (updater: (current: AssistantState) => AssistantState) => void;
  updatePreferences: (patch: Partial<AssistantPreferences>) => void;
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
    }),
    [state, isLoading, update, updatePreferences],
  );
};
