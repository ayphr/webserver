import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ASSISTANT_VARIANTS,
  estimateStreamingCredits,
  type AssistantChat,
  type AssistantContextUsage,
  type AssistantThinkingStep,
  type AssistantToolCall,
  type AssistantToolPermissionDecision,
  type AssistantToolResult,
  type AssistantUserQuestion,
  type AssistantVariant,
} from '@common';
import irisAnimation from '../../assets/animations/iris.webm';
import { AssistantStreamClient } from '../../lib/assistantStream';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { AssistantComposer } from './AssistantComposer';
import { Link } from 'react-router-dom';
import { AssistantMessages, type AssistantMessagesHandle } from './AssistantMessages';
import { AssistantToolbar } from './AssistantToolbar';
import type { AssistantChatAction, LiveAssistantMessage } from './types';
import type { AssistantController } from './useAssistantState';
import { createChatTitle, createId, mergeById, toPersistableMessage } from './utils';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
  username?: string;
  userCountry?: string;
  defaultVariant?: AssistantVariant;
  dataShared?: boolean;
  sendShortcut?: 'enter' | 'shift-enter';
  assistant: AssistantController;
  chatAction?: AssistantChatAction | null;
  onChatCreated?: (chatId: string) => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

const CHAT_SUBTITLE_TEXTS = (displayName: string) => [
  `What should we tackle, ${displayName}?`,
  'How can I help?',
  'Ready when you are.',
  'Let’s get to work.',
  'Ask me anything.',
  'What’s the plan today?',
  'Let’s make progress.',
  'How can I support you?',
  'What are we solving?',
  'Let’s get started.',
  'What’s on your agenda?',
  'Need a hand with something?',
  'Let’s dive in.',
  'What would you like to explore?',
  'Let’s turn data into answers.',
  'What can Iris do for you?',
  'Where should we begin?',
  'Let’s make today productive.',
  'What’s the next big question?',
  'I’m here to help.',
  'Let’s uncover some insights.',
  'What would you like to learn?',
  'Ready to explore your data?',
  'Let’s get things done.',
  'What’s on your mind?',
  'How can Iris assist?',
  'Let’s find the answer together.',
  'What should we focus on?',
  'Let’s take a look.',
  'What’s the challenge today?',
  'Let’s get to the bottom of it.',
  'How can I make things easier?',
  'What are we curious about?',
  'Let’s start something new.',
];

const TASK_SUBTITLE_TEXTS = (displayName: string) => [
  `What are we building, ${displayName}?`,
  'Let’s think long-term.',
  'Give me the big picture.',
  'Let’s break it down.',
  'What’s the end goal?',
  'Ready for a deep dive.',
  'Let’s map out the work.',
  'What should we tackle first?',
  'Tell me about the project.',
  'Let’s plan the next steps.',
  'Where are we headed?',
  'Let’s work through it together.',
  'What needs to get done?',
  'Let’s make a plan.',
  'What’s the real challenge?',
  'Let’s connect the dots.',
  'Think bigger with me.',
  'What does success look like?',
  'Let’s get strategic.',
  'I’m ready for the details.',
  'Let’s solve something complex.',
  'What’s the roadmap?',
  'Let’s dig deeper.',
  'Where should we start?',
  'Let’s build something great.',
  'What’s the scope?',
  'Let’s take it step by step.',
  'What’s the vision?',
  'Let’s see it through.',
  'What are we aiming for?',
  'Let’s lay the groundwork.',
  'Where do you want to go?',
  'Let’s make it happen.',
  'What’s the long game?',
];

const createShuffledOrder = (length: number, excludeFirst?: number): number[] => {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[randomIndex]] = [order[randomIndex], order[index]];
  }
  if (excludeFirst !== undefined && length > 1 && order[0] === excludeFirst) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
};

export const AssistantInput = ({
  placeholder = 'Ask Iris',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
  username,
  userCountry,
  defaultVariant,
  dataShared = true,
  sendShortcut = 'enter',
  assistant,
  chatAction = null,
  onChatCreated,
  onToggleSidebar,
  isSidebarOpen = false,
}: AssistantInputProps) => {
  const displayName = username?.trim() || 'there';
  const prefersReducedMotion = usePrefersReducedMotion();
  const { state } = assistant;
  const subtitles =
    state.activeMode === 'task'
      ? TASK_SUBTITLE_TEXTS(displayName)
      : CHAT_SUBTITLE_TEXTS(displayName);
  const updateAssistant = assistant.update;

  const [value, setValue] = useState('');
  const fallbackVariant = availableVariants.includes('standard')
    ? 'standard'
    : (availableVariants[0] ?? 'nano');
  const initialVariant =
    defaultVariant && availableVariants.includes(defaultVariant) ? defaultVariant : fallbackVariant;
  const [variant, setVariant] = useState<AssistantVariant>(initialVariant);
  const [messages, setMessages] = useState<LiveAssistantMessage[]>(() => {
    const chat = state.chats.find((item) => item.id === state.activeChatId);
    return chat?.messages ?? [];
  });
  const safetyLocked = messages.some((message) => Boolean(message.safetyNotice));
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const [subtitleSequence, setSubtitleSequence] = useState(() => ({
    mode: state.activeMode,
    order: createShuffledOrder(subtitles.length),
    position: 0,
    cycle: 0,
  }));
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [followSignal, setFollowSignal] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [contextUsage, setContextUsage] = useState<AssistantContextUsage | undefined>();
  const [isCompacting, setIsCompacting] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<{
    messageId: number;
    toolId: string;
    question: AssistantUserQuestion;
  } | null>(null);

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const assistantMessagesRef = useRef<AssistantMessagesHandle>(null);
  const messagesRef = useRef(messages);
  const currentChatIdRef = useRef(state.activeChatId);
  const queuedMessagesRef = useRef<string[]>([]);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamClientRef = useRef<AssistantStreamClient | null>(null);
  const streamRequestIdRef = useRef<string | null>(null);
  const streamCompleteRef = useRef<(() => void) | null>(null);
  const streamMessageIdRef = useRef<number | null>(null);
  const streamStartRef = useRef<number | null>(null);
  const streamLastEventWasToolRef = useRef(false);
  const compactRequestIdRef = useRef<string | null>(null);
  const contextUsageRef = useRef<AssistantContextUsage | undefined>(undefined);
  const questionRequestIdRef = useRef<string | null>(null);
  const processQueueRef = useRef<() => void>(() => {});
  const nextIdRef = useRef(messages.reduce((max, message) => Math.max(max, message.id), 0) + 1);

  const isChat = messages.length > 0;
  const activeChat = state.chats.find((item) => item.id === state.activeChatId);
  const isChatView = state.activeChatId !== null;
  const toolbarFolderId = isChatView ? (activeChat?.folderId ?? null) : state.activeFolderId;
  const toolbarMode = isChatView ? (activeChat?.mode ?? state.activeMode) : state.activeMode;
  const currentSubtitle = subtitles[subtitleSequence.order[subtitleSequence.position] ?? 0] ?? '';

  const handleOpenMenuChange = useCallback((id: number | null) => setOpenMenuId(id), []);
  const handleJumpToLatest = useCallback(() => {
    assistantMessagesRef.current?.jumpToLatest();
    setShowJumpToLatest(false);
  }, []);

  const commitMessages = useCallback(
    (updater: (previous: LiveAssistantMessage[]) => LiveAssistantMessage[]) => {
      setMessages((previous) => {
        const next = updater(previous);
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const persistMessages = useCallback(
    (chatId: string | null, nextMessages: LiveAssistantMessage[]) => {
      if (!chatId) return;
      updateAssistant((current) => ({
        ...current,
        chats: current.chats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: nextMessages.map(toPersistableMessage),
                updatedAt: Date.now(),
              }
            : chat,
        ),
      }));
    },
    [updateAssistant],
  );

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setSubtitleSequence((current) => {
        const nextPosition = current.position + 1;
        if (nextPosition < current.order.length) {
          return { ...current, position: nextPosition };
        }
        return {
          mode: current.mode,
          order: createShuffledOrder(current.order.length, current.order[current.order.length - 1]),
          position: 0,
          cycle: current.cycle + 1,
        };
      });
    }, 4000);
    return () => clearInterval(id);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (subtitleSequence.mode === state.activeMode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubtitleSequence({
      mode: state.activeMode,
      order: createShuffledOrder(subtitles.length),
      position: 0,
      cycle: 0,
    });
  }, [state.activeMode, subtitles.length, subtitleSequence.mode]);

  useEffect(() => {
    if (isGenerating) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowJumpToLatest(false);
    const chat = state.chats.find((item) => item.id === state.activeChatId);
    currentChatIdRef.current = state.activeChatId;
    setContextUsage(undefined);
    contextUsageRef.current = undefined;
    setActiveQuestion(null);
    questionRequestIdRef.current = null;
    nextIdRef.current = Math.max(
      nextIdRef.current,
      (chat?.messages ?? []).reduce((max, message) => Math.max(max, message.id), 0) + 1,
    );
    commitMessages(() => chat?.messages ?? []);
    // Sync only when opening or leaving a chat; message content is persisted by the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeChatId]);

  useEffect(() => {
    if (isChat || prefersReducedMotion) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => {
      // Autoplay can be blocked; the muted video element will still display its first frame.
    });
  }, [isChat, prefersReducedMotion, state.activeMode]);

  const setQueue = (next: string[]) => {
    queuedMessagesRef.current = next;
    setQueuedMessages(next);
  };

  const enqueueMessage = (text: string) => {
    setQueue([...queuedMessagesRef.current, text]);
  };

  const dequeueMessage = () => {
    const [next, ...rest] = queuedMessagesRef.current;
    setQueue(rest);
    return next;
  };

  const removeQueuedMessage = (index: number) => {
    setQueue(queuedMessagesRef.current.filter((_, itemIndex) => itemIndex !== index));
  };

  const editQueuedMessage = (index: number, text: string) => {
    const next = [...queuedMessagesRef.current];
    if (index < 0 || index >= next.length) return;
    next[index] = text;
    setQueue(next);
  };

  const moveQueuedMessage = (index: number, direction: -1 | 1) => {
    const next = [...queuedMessagesRef.current];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setQueue(next);
  };

  const takeStreamDuration = () => {
    const started = streamStartRef.current;
    streamStartRef.current = null;
    return started === null ? undefined : Math.max(1, Date.now() - started);
  };

  const cancelStream = () => {
    clearServerRefresh();
    streamLastEventWasToolRef.current = false;
    setActiveQuestion(null);
    questionRequestIdRef.current = null;
    const requestId = streamRequestIdRef.current;
    const messageId = streamMessageIdRef.current;
    if (requestId) streamClientRef.current?.cancel(requestId);
    streamRequestIdRef.current = null;
    streamCompleteRef.current = null;
    streamMessageIdRef.current = null;
    streamStartRef.current = null;
    if (messageId !== null) {
      commitMessages((previous) =>
        previous.map((m) =>
          m.id === messageId
            ? {
                ...m,
                liveDurationMs: undefined,
                liveTokensPerSecond: undefined,
                liveCreditCost: undefined,
                creditCost: m.liveCreditCost,
              }
            : m,
        ),
      );
    }
    setStreamingMessageId(null);
    setIsGenerating(false);
  };

  const handleStreamToken = (requestId: string, token: string) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;

    streamLastEventWasToolRef.current = false;
    const elapsedMs = Math.max(1, Date.now() - (streamStartRef.current ?? Date.now()));
    commitMessages((previous) =>
      previous.map((m) => {
        if (m.id !== messageId) return m;
        const content = m.content + token;
        const tokenCount = content.split(/\s+/).filter(Boolean).length;
        const usage = contextUsageRef.current;
        return {
          ...m,
          content,
          liveDurationMs: elapsedMs,
          liveTokensPerSecond: tokenCount / (elapsedMs / 1000),
          liveCreditCost: usage
            ? estimateStreamingCredits(usage.modelId, usage.usedTokens, content)
            : undefined,
        };
      }),
    );
  };

  const handleStreamThinking = (requestId: string, step: AssistantThinkingStep) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    streamLastEventWasToolRef.current = false;
    commitMessages((previous) =>
      previous.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? { ...m, thinking: mergeById(m.thinking, step) }
          : m,
      ),
    );
  };

  const handleStreamSafety = (requestId: string, notice: 'refusal' | 'crisis' | 'csam') => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    commitMessages((previous) =>
      previous.map((m) =>
        m.id === messageId && m.role === 'assistant' ? { ...m, safetyNotice: notice } : m,
      ),
    );
  };

  const handleStreamContext = (requestId: string, usage: AssistantContextUsage) => {
    if (usage.chatId && usage.chatId !== currentChatIdRef.current) return;
    setContextUsage(usage);
    contextUsageRef.current = usage;
    if (requestId === compactRequestIdRef.current) {
      compactRequestIdRef.current = null;
      setIsCompacting(false);
      void assistant.refresh();
    }
  };

  const handleCompactContext = () => {
    const chatId = currentChatIdRef.current;
    if (!chatId || compactRequestIdRef.current) return;
    const requestId = createId();
    compactRequestIdRef.current = requestId;
    setIsCompacting(true);
    getStreamClient().compact(requestId, chatId, variant);
  };

  const handleStreamTool = (requestId: string, tool: AssistantToolCall) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    const consecutive = streamLastEventWasToolRef.current;
    streamLastEventWasToolRef.current = true;
    commitMessages((previous) =>
      previous.map((m) => {
        if (m.id !== messageId || m.role !== 'assistant') return m;
        const offset = m.content.length;
        const toolWithOffset = { ...tool, contentOffset: offset };
        const tools = mergeById(m.tools, toolWithOffset);
        const groups = (m.toolGroups ?? []).map((group) => [...group]);
        let placed = false;
        for (const group of groups) {
          const index = group.findIndex((item) => item.id === tool.id);
          if (index !== -1) {
            group[index] = toolWithOffset;
            placed = true;
            break;
          }
        }
        if (!placed) {
          if (consecutive && groups.length > 0) {
            groups[groups.length - 1] = [...groups[groups.length - 1], toolWithOffset];
          } else {
            groups.push([toolWithOffset]);
          }
        }
        return { ...m, tools, toolGroups: groups };
      }),
    );
  };

  const handleToolPermissionRequest = (requestId: string, tool: AssistantToolCall) => {
    handleStreamTool(requestId, tool);
  };

  const handleToolPermission = (toolId: string, decision: AssistantToolPermissionDecision) => {
    const requestId = streamRequestIdRef.current;
    if (!requestId) return;

    const activeTool = messagesRef.current
      .find((message) => message.id === streamMessageIdRef.current)
      ?.tools?.find((tool) => tool.id === toolId);
    if (decision === 'allow_always' && activeTool) {
      assistant.allowTool(activeTool.name);
    }

    getStreamClient().respondToToolPermission(requestId, toolId, decision);
  };

  const handleStreamToolResult = (
    requestId: string,
    toolId: string,
    result: AssistantToolResult,
  ) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;

    setActiveQuestion((current) => (current?.toolId === toolId ? null : current));
    questionRequestIdRef.current = null;
    commitMessages((previous) =>
      previous.map((message) => {
        if (message.id !== messageId || message.role !== 'assistant') return message;
        const updateTool = (tool: AssistantToolCall): AssistantToolCall =>
          tool.id === toolId
            ? {
                ...tool,
                status: result.status === 'ok' ? 'done' : 'error',
                detail: result.summary,
                error: result.error,
                result,
              }
            : tool;
        return {
          ...message,
          tools: (message.tools ?? []).map(updateTool),
          toolGroups: message.toolGroups?.map((group) => group.map(updateTool)),
        };
      }),
    );
  };

  const handleStreamUserQuestion = (
    requestId: string,
    toolId: string,
    question: AssistantUserQuestion,
  ) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    questionRequestIdRef.current = requestId;
    setActiveQuestion({ messageId, toolId, question });
  };

  const handleToolAnswer = (
    toolId: string,
    answers: Record<string, string>,
    customAnswer?: string,
  ) => {
    const requestId = questionRequestIdRef.current ?? streamRequestIdRef.current;
    if (requestId) {
      getStreamClient().respondToTool(requestId, toolId, answers, customAnswer);
    }
    questionRequestIdRef.current = null;
    setActiveQuestion(null);
  };

  const clearServerRefresh = () => {
    if (serverRefreshTimerRef.current) clearTimeout(serverRefreshTimerRef.current);
    serverRefreshTimerRef.current = null;
  };

  /**
   * A disconnected socket only stops the live feed; the server keeps running and
   * persists the final response. Poll the authoritative state until it appears.
   */
  const waitForServerResult = (chatId: string, messageId: number, attempt = 0) => {
    clearServerRefresh();
    const delays = [1000, 2000, 4000, 8000, 12000];
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 12000;
    serverRefreshTimerRef.current = setTimeout(async () => {
      serverRefreshTimerRef.current = null;
      if (streamRequestIdRef.current !== null || currentChatIdRef.current !== chatId) return;
      const latest = await assistant.refresh();
      const chat = latest.chats.find((item) => item.id === chatId);
      const result = chat?.messages.find(
        (item) => item.id === messageId && item.role === 'assistant' && Boolean(item.content),
      );
      if (result) {
        commitMessages(() => chat?.messages ?? []);
        return;
      }
      waitForServerResult(chatId, messageId, attempt + 1);
    }, delay);
  };

  const finishStream = (
    requestId: string,
    error?: string,
    serverDurationMs?: number,
    serverCreditCost?: number,
  ) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    const elapsedMs = takeStreamDuration();
    const durationMs = serverDurationMs ?? elapsedMs;
    const complete = streamCompleteRef.current;
    const isDisconnect = error === 'Stream disconnected';
    streamRequestIdRef.current = null;
    streamCompleteRef.current = null;
    streamMessageIdRef.current = null;
    setStreamingMessageId(null);
    setActiveQuestion(null);
    questionRequestIdRef.current = null;

    if (messageId !== null) {
      const next = messagesRef.current.map((m) =>
        m.id === messageId
          ? {
              ...m,
              durationMs: m.durationMs ?? durationMs,
              liveDurationMs: undefined,
              liveTokensPerSecond: undefined,
              liveCreditCost: undefined,
              creditCost: serverCreditCost ?? m.liveCreditCost,
              ...(error && !isDisconnect ? { error } : {}),
            }
          : m,
      );
      // Streamed content is display-only. The server persists the authoritative
      // response, so do not write local messages back into assistant state.
      commitMessages(() => next);
    }

    // Every stream runs on the server; reload its authoritative result once done.
    if (!error) {
      void assistant.refresh();
    } else if (isDisconnect && currentChatIdRef.current && messageId !== null) {
      waitForServerResult(currentChatIdRef.current, messageId);
    }
    if (complete) complete();
    else setIsGenerating(false);
  };

  const handleStreamDone = (requestId: string, durationMs?: number, creditCost?: number) => {
    finishStream(requestId, undefined, durationMs, creditCost);
  };

  const handleStreamError = (requestId: string, error: string) => {
    finishStream(requestId, error);
  };

  const getStreamClient = () => {
    if (!streamClientRef.current) {
      streamClientRef.current = new AssistantStreamClient({
        onToken: handleStreamToken,
        onThinking: handleStreamThinking,
        onTool: handleStreamTool,
        onSafety: handleStreamSafety,
        onToolPermissionRequest: handleToolPermissionRequest,
        onContext: handleStreamContext,
        onToolResult: handleStreamToolResult,
        onUserQuestion: handleStreamUserQuestion,
        onDone: handleStreamDone,
        onError: handleStreamError,
      });
    }
    return streamClientRef.current;
  };

  const stopGeneration = (options: { continueQueue?: boolean } = {}) => {
    const messageId = streamMessageIdRef.current;
    const durationMs = takeStreamDuration();
    cancelStream();

    let next = messagesRef.current;
    if (messageId !== null) {
      next = next.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? {
              ...m,
              interrupted: true,
              durationMs: m.durationMs ?? durationMs,
              liveDurationMs: undefined,
              liveTokensPerSecond: undefined,
              liveCreditCost: undefined,
              creditCost: m.liveCreditCost,
            }
          : m,
      );
      commitMessages(() => next);
    }

    if (options.continueQueue && queuedMessagesRef.current.length > 0) processQueueRef.current();
    else setIsGenerating(false);
  };

  const createChat = (folderId: string | null, mode: AssistantChat['mode']) => {
    const chat = assistant.createChat(folderId, mode);
    onChatCreated?.(chat.id);
    return chat;
  };

  const handleNewChat = () => {
    stopGeneration();
    setQueue([]);
    commitMessages(() => []);
    currentChatIdRef.current = null;
    setValue('');
    setOpenMenuId(null);
    assistant.update((current) => ({ ...current, activeChatId: null }));
    textareaRef.current?.focus();
  };

  const handleOpenChat = (id: string) => {
    const chat = state.chats.find((item) => item.id === id);
    if (!chat) return;
    stopGeneration();
    setQueue([]);
    commitMessages(() => chat.messages);
    currentChatIdRef.current = chat.id;
    nextIdRef.current = chat.messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;
    assistant.update((current) => ({
      ...current,
      activeChatId: chat.id,
      activeMode: chat.mode,
    }));
    setOpenMenuId(null);

    const lastVariant = [...chat.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.variant)?.variant;
    if (lastVariant && availableVariants.includes(lastVariant)) setVariant(lastVariant);

    textareaRef.current?.focus();
  };

  const lastChatActionTokenRef = useRef(chatAction?.token);

  useEffect(() => {
    if (!chatAction || chatAction.token === lastChatActionTokenRef.current) return;
    lastChatActionTokenRef.current = chatAction.token;
    if (chatAction.type === 'new') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleNewChat();
    } else {
      handleOpenChat(chatAction.chatId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatAction]);

  const handleFeedback = (messageId: number, feedback: 'like' | 'dislike') => {
    const next = messagesRef.current.map((m) =>
      m.id === messageId && m.role === 'assistant'
        ? { ...m, feedback: m.feedback === feedback ? null : feedback }
        : m,
    );
    commitMessages(() => next);
    persistMessages(currentChatIdRef.current, next);
  };

  const handleUndo = (messageId: number) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const userMessage = messages[index];
    const assistantMessage =
      index + 1 < messages.length && messages[index + 1].role === 'assistant'
        ? messages[index + 1]
        : undefined;

    const removedIds = new Set(messages.slice(index).map((m) => m.id));
    if (streamMessageIdRef.current !== null && removedIds.has(streamMessageIdRef.current)) {
      stopGeneration();
    }
    if (assistantMessage?.variant) {
      setVariant(assistantMessage.variant);
    }
    setValue(userMessage.content);
    setQueue([]);

    const trimmed = messages.slice(0, index);
    commitMessages(() => trimmed);
    persistMessages(currentChatIdRef.current, trimmed);
    setOpenMenuId(null);
    textareaRef.current?.focus();
  };

  const handleRegenerate = (messageId: number) => {
    if (messages[messages.length - 1]?.id !== messageId) return;
    stopGeneration();
    const reset = messagesRef.current.map((m) =>
      m.id === messageId && m.role === 'assistant'
        ? {
            ...m,
            content: '',
            interrupted: false,
            error: undefined,
            feedback: null,
            durationMs: undefined,
            variant,
            thinking: [],
            tools: [],
          }
        : m,
    );
    commitMessages(() => reset);
    startStreaming(messageId, processQueue);
  };

  const copyMessage = async (messageId: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopiedId(messageId);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard access can be unavailable; ignore.
    }
  };

  const startStreaming = (messageId: number, onComplete?: () => void, prompt?: string) => {
    clearServerRefresh();
    const requestId = createId();
    streamRequestIdRef.current = requestId;
    streamCompleteRef.current = onComplete ?? null;
    streamMessageIdRef.current = messageId;
    streamStartRef.current = Date.now();
    streamLastEventWasToolRef.current = false;
    setStreamingMessageId(messageId);
    setIsGenerating(true);
    commitMessages((previous) =>
      previous.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? {
              ...m,
              thinking: [],
              tools: [],
              toolGroups: [],
              liveDurationMs: 0,
              liveTokensPerSecond: 0,
              liveCreditCost: 0,
              creditCost: undefined,
            }
          : m,
      ),
    );
    getStreamClient().stream(requestId, {
      mode: state.activeMode,
      variant,
      permissionLevel: assistant.preferences.permissionLevel,
      allowedTools: assistant.preferences.allowedTools,
      chatId: currentChatIdRef.current ?? undefined,
      messageId,
      prompt,
      notificationLevel: assistant.preferences.notificationLevel,
    });
  };

  const appendAndStream = (text: string, onComplete?: () => void) => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    let chatId = state.activeChatId;
    if (!chatId) {
      const chat = createChat(state.activeFolderId, state.activeMode);
      chatId = chat.id;
      assistant.renameChat(
        chat.id,
        createChatTitle(trimmed, state.activeMode === 'task' ? 'New task' : 'New chat'),
      );
    }
    currentChatIdRef.current = chatId;

    const now = Date.now();
    const userMessage: LiveAssistantMessage = {
      id: nextIdRef.current++,
      role: 'user',
      content: trimmed,
      createdAt: now,
    };
    const assistantId = nextIdRef.current++;
    commitMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        interrupted: false,
        feedback: null,
        variant,
        thinking: [],
        tools: [],
      },
    ]);
    setValue('');
    setFollowSignal((signal) => signal + 1);

    startStreaming(assistantId, onComplete, trimmed);
    return true;
  };

  // processQueue is intentionally refreshed every render so queued sends always
  // see the latest stream/variant state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const processQueue = () => {
    const next = dequeueMessage();
    if (next) appendAndStream(next, processQueue);
    else setIsGenerating(false);
  };

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const sendMessageText = (text: string) => {
    if (appendAndStream(text, processQueue)) {
      textareaRef.current?.focus();
    }
  };

  const handleSend = () => {
    if (safetyLocked) return;
    if (isGenerating) {
      stopGeneration({ continueQueue: true });
      return;
    }
    const currentValue = value.trim() ? value : (textareaRef.current?.value ?? '');
    sendMessageText(currentValue);
  };

  const queueCurrentMessage = () => {
    const currentValue = value.trim() ? value : (textareaRef.current?.value ?? '');
    const trimmed = currentValue.trim();
    if (!trimmed) return;
    enqueueMessage(trimmed);
    setValue('');
    if (!isGenerating) processQueue();
    textareaRef.current?.focus();
  };

  useEffect(
    () => () => {
      if (serverRefreshTimerRef.current) clearTimeout(serverRefreshTimerRef.current);
      streamClientRef.current?.close();
    },
    [],
  );

  return (
    <div className={`assistant-input ${isChat ? 'assistant-input--chat' : 'assistant-input--new-chat'} ${className}`}>
      <div className="assistant-input__stack">
        {!isChat && (
          <div className="assistant-input__intro">
            <video
              ref={videoRef}
              className="assistant-input__animation"
              src={irisAnimation}
              autoPlay={!prefersReducedMotion}
              muted
              playsInline
              preload="auto"
              aria-hidden="true"
            />
            <p
              key={`${state.activeMode}-${subtitleSequence.cycle}-${subtitleSequence.position}`}
              className="assistant-input__subtitle"
            >
              {currentSubtitle}
            </p>
          </div>
        )}
        {isChat && (
          <AssistantMessages
            key={state.activeChatId ?? 'new'}
            ref={assistantMessagesRef}
            messages={messages}
            queuedMessages={queuedMessages}
            streamingMessageId={streamingMessageId}
            followSignal={followSignal}
            openMenuId={openMenuId}
            onOpenMenuChange={handleOpenMenuChange}
            copiedId={copiedId}
            fallbackVariant={variant}
            userCountry={userCountry}
            onUndo={handleUndo}
            onFeedback={handleFeedback}
            onRegenerate={handleRegenerate}
            onToolPermission={handleToolPermission}
            activeQuestion={activeQuestion}
            onToolAnswer={handleToolAnswer}
            onCopy={copyMessage}
            onRemoveQueued={removeQueuedMessage}
            onMoveQueued={moveQueuedMessage}
            onEditQueued={editQueuedMessage}
            onJumpVisibilityChange={setShowJumpToLatest}
          />
        )}
        <div className="assistant-input__composer">
          <AssistantToolbar
            folders={state.folders}
            activeFolderId={toolbarFolderId}
            activeMode={toolbarMode}
            permissionLevel={assistant.preferences.permissionLevel}
            notificationLevel={assistant.preferences.notificationLevel}
            onSelectFolder={assistant.selectFolder}
            onSelectMode={assistant.selectMode}
            onSelectPermissionLevel={assistant.selectPermissionLevel}
            onSelectNotificationLevel={assistant.selectNotificationLevel}
            onCreateFolder={assistant.createFolder}
            showControls={!state.activeChatId}
            onToggleSidebar={onToggleSidebar}
            isSidebarOpen={isSidebarOpen}
            showJumpToLatest={showJumpToLatest}
            onJumpToLatest={handleJumpToLatest}
          />
          {safetyLocked ? (
            <p className="assistant-input__disclaimer">
              Iris is AI. By using it, you agree to our{' '}
              <Link to="/policies/terms">Terms</Link> &amp;{' '}
              <Link to="/policies/privacy">Privacy Policy</Link>.{' '}
              {dataShared
                ? 'Chats may be reviewed and used to improve our AI models and enforce the Terms.'
                : 'Chats may be reviewed to enforce the Terms.'}
            </p>
          ) : (
            <AssistantComposer
              placeholder={placeholder}
              value={value}
              onValueChange={setValue}
              variant={variant}
              onVariantChange={setVariant}
              availableVariants={availableVariants}
              isChat={isChat}
              isGenerating={isGenerating}
              sendShortcut={sendShortcut}
              isMac={isMac}
              textareaRef={textareaRef}
              dataShared={dataShared}
              onSend={handleSend}
              onQueue={queueCurrentMessage}
              contextUsage={contextUsage}
              onCompact={handleCompactContext}
              showContextGauge={toolbarMode === 'chat'}
              isCompacting={isCompacting}
            />
          )}
        </div>
      </div>
    </div>
  );
};
