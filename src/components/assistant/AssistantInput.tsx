import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ASSISTANT_VARIANTS,
  type AssistantChat,
  type AssistantThinkingStep,
  type AssistantToolCall,
  type AssistantVariant,
} from '@common';
import irisAnimation from '../../assets/animations/iris.webm';
import { AssistantStreamClient } from '../../lib/assistantStream';
import { AssistantComposer } from './AssistantComposer';
import { AssistantMessages } from './AssistantMessages';
import { AssistantToolbar } from './AssistantToolbar';
import type { AssistantChatAction, LiveAssistantMessage } from './types';
import type { AssistantController } from './useAssistantState';
import { createId, mergeById, toPersistableMessage } from './utils';
import './AssistantInput.css';

export interface AssistantInputProps {
  placeholder?: string;
  className?: string;
  availableVariants?: AssistantVariant[];
  username?: string;
  defaultVariant?: AssistantVariant;
  dataShared?: boolean;
  sendShortcut?: 'enter' | 'shift-enter';
  assistant: AssistantController;
  chatAction?: AssistantChatAction | null;
  onChatCreated?: (chatId: string) => void;
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

export const AssistantInput = ({
  placeholder = 'Ask Iris',
  className = '',
  availableVariants = ASSISTANT_VARIANTS,
  username,
  defaultVariant,
  dataShared = true,
  sendShortcut = 'enter',
  assistant,
  chatAction = null,
  onChatCreated,
}: AssistantInputProps) => {
  const displayName = username?.trim() || 'there';
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const queuedMessagesRef = useRef<string[]>([]);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamClientRef = useRef<AssistantStreamClient | null>(null);
  const streamRequestIdRef = useRef<string | null>(null);
  const streamCompleteRef = useRef<(() => void) | null>(null);
  const streamMessageIdRef = useRef<number | null>(null);
  const streamStartRef = useRef<number | null>(null);
  const nextIdRef = useRef(messages.reduce((max, message) => Math.max(max, message.id), 0) + 1);

  const isChat = messages.length > 0;

  const handleOpenMenuChange = useCallback((id: number | null) => setOpenMenuId(id), []);

  useEffect(() => {
    if (!availableVariants.includes(variant)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVariant(fallbackVariant);
    }
  }, [availableVariants, fallbackVariant, variant]);

  useEffect(() => {
    const id = setInterval(() => {
      setSubtitleIndex((i) => (i + 1) % subtitles.length);
    }, 4000);
    return () => clearInterval(id);
  }, [subtitles.length]);

  useEffect(() => {
    if (isGenerating) return;
    const chat = state.chats.find((item) => item.id === state.activeChatId);
    nextIdRef.current = Math.max(
      nextIdRef.current,
      (chat?.messages ?? []).reduce((max, message) => Math.max(max, message.id), 0) + 1,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(chat?.messages ?? []);
    // Sync only when opening or leaving a chat; local message changes are persisted below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeChatId]);

  useEffect(() => {
    if (!state.activeChatId || isGenerating) return;
    updateAssistant((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === state.activeChatId
          ? {
              ...chat,
              messages: messages.map(toPersistableMessage),
              updatedAt: Date.now(),
            }
          : chat,
      ),
    }));
  }, [updateAssistant, isGenerating, messages, state.activeChatId]);

  useEffect(() => {
    if (isChat) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => {
      // Autoplay can be blocked; the muted video element will still display its first frame.
    });
  }, [isChat, state.activeMode]);

  const enqueueMessage = (text: string) => {
    queuedMessagesRef.current = [...queuedMessagesRef.current, text];
    setQueuedMessages(queuedMessagesRef.current);
  };

  const dequeueMessage = () => {
    const [next, ...rest] = queuedMessagesRef.current;
    queuedMessagesRef.current = rest;
    setQueuedMessages(rest);
    return next;
  };

  const takeStreamDuration = () => {
    const started = streamStartRef.current;
    streamStartRef.current = null;
    return started === null ? undefined : Math.max(1, Date.now() - started);
  };

  const cancelStream = () => {
    const requestId = streamRequestIdRef.current;
    if (requestId) streamClientRef.current?.cancel(requestId);
    streamRequestIdRef.current = null;
    streamCompleteRef.current = null;
    streamMessageIdRef.current = null;
    streamStartRef.current = null;
    setStreamingMessageId(null);
    setIsGenerating(false);
  };

  const handleStreamToken = (requestId: string, token: string) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;

    const elapsedMs = Math.max(1, Date.now() - (streamStartRef.current ?? Date.now()));
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const content = m.content + token;
        const tokenCount = content.split(/\s+/).filter(Boolean).length;
        return {
          ...m,
          content,
          liveDurationMs: elapsedMs,
          liveTokensPerSecond: tokenCount / (elapsedMs / 1000),
        };
      }),
    );
  };

  const handleStreamThinking = (requestId: string, step: AssistantThinkingStep) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? { ...m, thinking: mergeById(m.thinking, step) }
          : m,
      ),
    );
  };

  const handleStreamTool = (requestId: string, tool: AssistantToolCall) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    if (messageId === null) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant' ? { ...m, tools: mergeById(m.tools, tool) } : m,
      ),
    );
  };

  const finishStream = (requestId: string, error?: string, serverDurationMs?: number) => {
    if (requestId !== streamRequestIdRef.current) return;
    const messageId = streamMessageIdRef.current;
    const elapsedMs = takeStreamDuration();
    const durationMs = serverDurationMs ?? elapsedMs;
    const complete = streamCompleteRef.current;
    streamRequestIdRef.current = null;
    streamCompleteRef.current = null;
    streamMessageIdRef.current = null;
    setStreamingMessageId(null);

    if (messageId !== null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                durationMs: m.durationMs ?? durationMs,
                liveDurationMs: undefined,
                liveTokensPerSecond: undefined,
                ...(error ? { error } : {}),
              }
            : m,
        ),
      );
    }

    if (complete) complete();
    else setIsGenerating(false);
  };

  const handleStreamDone = (requestId: string, durationMs?: number) => {
    finishStream(requestId, undefined, durationMs);
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
        onDone: handleStreamDone,
        onError: handleStreamError,
      });
    }
    return streamClientRef.current;
  };

  const stopGeneration = () => {
    const messageId = streamMessageIdRef.current;
    const durationMs = takeStreamDuration();
    cancelStream();
    if (messageId !== null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === 'assistant'
            ? { ...m, interrupted: true, durationMs: m.durationMs ?? durationMs }
            : m,
        ),
      );
    }
  };

  const createChat = (folderId: string | null, mode: AssistantChat['mode']) => {
    const chat = assistant.createChat(folderId, mode);
    onChatCreated?.(chat.id);
    return chat;
  };

  const handleNewChat = () => {
    cancelStream();
    queuedMessagesRef.current = [];
    setQueuedMessages([]);
    setMessages([]);
    setValue('');
    setOpenMenuId(null);
    assistant.update((current) => ({ ...current, activeChatId: null }));
    textareaRef.current?.focus();
  };

  const handleOpenChat = (id: string) => {
    const chat = state.chats.find((item) => item.id === id);
    if (!chat) return;
    cancelStream();
    queuedMessagesRef.current = [];
    setQueuedMessages([]);
    setValue('');
    setMessages(chat.messages);
    nextIdRef.current = chat.messages.reduce((max, message) => Math.max(max, message.id), 0) + 1;
    assistant.update((current) => ({ ...current, activeChatId: chat.id }));
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
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? { ...m, feedback: m.feedback === feedback ? null : feedback }
          : m,
      ),
    );
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
      cancelStream();
    }
    if (assistantMessage?.variant) {
      setVariant(assistantMessage.variant);
    }
    setValue(userMessage.content);
    if (textareaRef.current) textareaRef.current.value = userMessage.content;
    queuedMessagesRef.current = [];
    setQueuedMessages([]);

    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === messageId);
      return i === -1 ? prev : prev.slice(0, i);
    });
    setOpenMenuId(null);
    textareaRef.current?.focus();
  };

  const handleRegenerate = (messageId: number) => {
    if (messages[messages.length - 1]?.id !== messageId) return;
    cancelStream();
    setMessages((prev) =>
      prev.map((m) =>
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
      ),
    );
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

  const startStreaming = (messageId: number, onComplete?: () => void) => {
    const requestId = createId();
    streamRequestIdRef.current = requestId;
    streamCompleteRef.current = onComplete ?? null;
    streamMessageIdRef.current = messageId;
    streamStartRef.current = Date.now();
    setStreamingMessageId(messageId);
    setIsGenerating(true);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === 'assistant'
          ? {
              ...m,
              thinking: [],
              tools: [],
              liveDurationMs: 0,
              liveTokensPerSecond: 0,
            }
          : m,
      ),
    );
    getStreamClient().stream(requestId, { mode: state.activeMode, variant });
  };

  const appendAndStream = (text: string, onComplete?: () => void) => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    if (!state.activeChatId) createChat(state.activeFolderId, state.activeMode);

    const now = Date.now();
    const userMessage: LiveAssistantMessage = {
      id: nextIdRef.current++,
      role: 'user',
      content: trimmed,
      createdAt: now,
    };
    const assistantId = nextIdRef.current++;
    setMessages((prev) => [
      ...prev,
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
    if (textareaRef.current) textareaRef.current.value = '';

    startStreaming(assistantId, onComplete);
    return true;
  };

  const processQueue = () => {
    const next = dequeueMessage();
    if (next) appendAndStream(next, processQueue);
    else setIsGenerating(false);
  };

  const sendMessageText = (text: string) => {
    if (appendAndStream(text, processQueue)) {
      textareaRef.current?.focus();
    }
  };

  const handleSend = () => {
    if (isGenerating) {
      stopGeneration();
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
    if (textareaRef.current) textareaRef.current.value = '';
    if (!isGenerating) processQueue();
    textareaRef.current?.focus();
  };

  return (
    <div className={`assistant-input ${isChat ? 'assistant-input--chat' : 'assistant-input--new-chat'} ${className}`}>
      <div className="assistant-input__stack">
        {!isChat && (
          <div className="assistant-input__intro">
            <video
              ref={videoRef}
              className="assistant-input__animation"
              src={irisAnimation}
              autoPlay
              muted
              playsInline
              preload="auto"
              aria-hidden="true"
            />
            <p
              key={`${state.activeMode}-${subtitleIndex}`}
              className="assistant-input__subtitle"
            >
              {subtitles[subtitleIndex % subtitles.length]}
            </p>
          </div>
        )}
        {isChat && (
          <AssistantMessages
            key={state.activeChatId ?? 'new'}
            messages={messages}
            queuedMessages={queuedMessages}
            streamingMessageId={streamingMessageId}
            openMenuId={openMenuId}
            onOpenMenuChange={handleOpenMenuChange}
            copiedId={copiedId}
            fallbackVariant={variant}
            onUndo={handleUndo}
            onFeedback={handleFeedback}
            onRegenerate={handleRegenerate}
            onCopy={copyMessage}
          />
        )}
        <div className="assistant-input__composer">
          <AssistantToolbar
            folders={state.folders}
            activeFolderId={state.activeFolderId}
            activeMode={state.activeMode}
            onSelectFolder={assistant.selectFolder}
            onSelectMode={assistant.selectMode}
            onCreateFolder={assistant.createFolder}
            showControls={!state.activeChatId}
          />
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
          />
        </div>
      </div>
    </div>
  );
};
