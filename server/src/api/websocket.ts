import type { ServerWebSocket, WebSocketHandler } from 'bun';
import {
  ASSISTANT_LOCATIONS,
  ASSISTANT_MODES,
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_TOOL_PERMISSION_DECISIONS,
  ASSISTANT_VARIANTS,
  createDefaultAssistantState,
  type AssistantLocation,
  type AssistantMessage,
  type AssistantMode,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantStreamClientMessage,
  type AssistantStreamServerMessage,
  type AssistantThinkingStatus,
  type AssistantToolCall,
  type AssistantToolPermission,
  type AssistantToolPermissionDecision,
  type AssistantToolStatus,
  type AssistantVariant,
} from '@common';
import { runBackgroundTask } from '../lib/backgroundTasks';
import { createAssistantMockStream, splitAssistantResponseIntoTokens } from '../lib/assistantStream';
import { getAssistantState, saveAssistantState } from '../lib/db/assistant';
import { createLogger } from '../lib/logger';
import { notifyUser } from '../lib/notifications';
import { getUserFromToken } from './auth';

const log = createLogger('assistant-websocket');

export type AssistantSocketData = { userUuid: string | null };
type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type Timer = ReturnType<typeof setTimeout>;

type ActiveStream = {
  cancelled: boolean;
  timers: Set<Timer>;
  cloudKey?: string;
  notificationLink?: string;
  notificationLevel?: AssistantNotificationLevel;
  orphaned?: boolean;
  onOrphaned?: () => void;
};
type ActiveStreams = Map<string, ActiveStream>;
type ToolPermissionHandler = (
  toolId: string,
  decision: AssistantToolPermissionDecision,
) => void;
type CloudTask = { timers: Set<Timer> };
type CloudNotifyKind = 'progress' | 'finish' | 'error';

const MAX_CONCURRENT_STREAMS = 8;
const AUTH_TIMEOUT_MS = 10_000;
const FIRST_TOKEN_DELAY_MS = 300;
const TOKEN_DELAY_MIN_MS = 70;
const TOKEN_DELAY_VARY_MS = 50;
const CLOUD_FIRST_PROGRESS_MS = 900;
const CLOUD_PROGRESS_STEP_MS = 1_400;
const DEFAULT_CLOUD_LINK = '/dashboard';

const assistantChatLink = (chatId?: string) =>
  chatId
    ? `/dashboard/assistant/chat/${encodeURIComponent(chatId)}`
    : DEFAULT_CLOUD_LINK;

/** Example tools that need approval under "Sometimes ask". */
const SENSITIVE_TOOLS = new Set(['data.query', 'docs.lookup']);

const activeStreams = new Map<AssistantWebSocket, ActiveStreams>();
const authTimers = new Map<AssistantWebSocket, Timer>();
const messageQueues = new Map<AssistantWebSocket, Promise<void>>();
const toolPermissionHandlers = new Map<string, ToolPermissionHandler>();
const cloudTasks = new Map<string, CloudTask>();

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

const send = (ws: AssistantWebSocket, message: AssistantStreamServerMessage) => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(message));
};

const rejectUnauthenticated = (ws: AssistantWebSocket, error: string) => {
  send(ws, { type: 'auth_error', error });
  ws.close();
};

const clearTimers = (timers: Set<Timer>) => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
};

const notifyCloudUser = (
  userUuid: string,
  title: string,
  message: string,
  link: string = DEFAULT_CLOUD_LINK,
  notificationLevel: AssistantNotificationLevel = 'always',
  kind: CloudNotifyKind = 'progress',
) => {
  if (notificationLevel === 'never') return;
  if (notificationLevel === 'sometimes' && kind === 'progress') return;

  void runBackgroundTask('assistant-cloud-progress', () =>
    notifyUser({
      userUuid,
      type: 'assistant_task',
      title,
      message,
      link,
    }),
  );
};

type CloudResultInput = {
  userUuid: string;
  chatId?: string;
  messageId?: number;
  prompt?: string;
  mode: AssistantMode;
  variant: AssistantVariant;
  content: string;
  thinking: NonNullable<AssistantMessage['thinking']>;
  tools: NonNullable<AssistantMessage['tools']>;
  durationMs: number;
  notificationLevel: AssistantNotificationLevel;
  link: string;
};

/** Persist a cloud result when its original client connection is gone. */
const persistCloudResult = async (input: CloudResultInput): Promise<void> => {
  if (!input.chatId) return;

  try {
    const state = (await getAssistantState(input.userUuid)) ?? createDefaultAssistantState();
    const now = Date.now();
    const assistantMessage: AssistantMessage = {
      id: input.messageId && input.messageId > 0 ? input.messageId : 2,
      role: 'assistant',
      content: input.content,
      createdAt: now,
      variant: input.variant,
      durationMs: input.durationMs,
      thinking: (input.thinking ?? []).map((step) => ({ ...step, status: 'done' })),
      tools: input.tools ?? [],
    };

    let chat = state.chats.find((item) => item.id === input.chatId);
    if (!chat) {
      const userMessage: AssistantMessage = {
        id: Math.max(1, assistantMessage.id - 1),
        role: 'user',
        content: input.prompt ?? '',
        createdAt: now - 1,
      };
      const created: AssistantMessage[] = [userMessage, assistantMessage];
      chat = {
        id: input.chatId,
        title: input.prompt?.trim().slice(0, 60) || 'Cloud task',
        folderId: null,
        mode: input.mode,
        messages: created,
        createdAt: now,
        updatedAt: now,
      };
      state.chats = [chat, ...state.chats];
    } else {
      const messages = [...chat.messages];
      const exactIndex = messages.findIndex(
        (message) => message.id === assistantMessage.id && message.role === 'assistant',
      );
      const fallbackIndex = messages.map((message) => message.role).lastIndexOf('assistant');
      const index = exactIndex >= 0 ? exactIndex : fallbackIndex;
      if (index >= 0) {
        const existing = messages[index]!;
        messages[index] = {
          ...existing,
          ...assistantMessage,
          createdAt: existing.createdAt || assistantMessage.createdAt,
        };
      } else {
        messages.push(assistantMessage);
      }
      chat.messages = messages;
      chat.updatedAt = now;
      const updatedChat = chat;
      state.chats = state.chats.map((item) => (item.id === updatedChat.id ? updatedChat : item));
    }

    await saveAssistantState(input.userUuid, state);
  } catch (error) {
    log.warn({ error, userUuid: input.userUuid, chatId: input.chatId }, 'failed to persist cloud task result');
    notifyCloudUser(
      input.userUuid,
      'Cloud task could not be saved',
      'The task finished, but its result could not be saved to the chat.',
      input.link,
      input.notificationLevel,
      'error',
    );
  }
};

const clearCloudTask = (key: string) => {
  const task = cloudTasks.get(key);
  if (!task) return;
  clearTimers(task.timers);
  cloudTasks.delete(key);
};

const startCloudTask = (
  key: string,
  userUuid: string,
  requestId: string,
  steps: string[],
  link: string,
  notificationLevel: AssistantNotificationLevel,
) => {
  clearCloudTask(key);
  const task: CloudTask = { timers: new Set() };
  cloudTasks.set(key, task);

  notifyCloudUser(
    userUuid,
    'Cloud task started',
    `Task ${requestId.slice(-6)} is running on the server.`,
    link,
    notificationLevel,
    'progress',
  );

  steps.slice(0, 3).forEach((step, index) => {
    const timer = setTimeout(() => {
      task.timers.delete(timer);
      if (!cloudTasks.has(key)) return;
      notifyCloudUser(userUuid, 'Cloud task is working', `${step}…`, link, notificationLevel, 'progress');
    }, CLOUD_FIRST_PROGRESS_MS + index * CLOUD_PROGRESS_STEP_MS);
    task.timers.add(timer);
    timer.unref?.();
  });
};

const cancelStream = (
  ws: AssistantWebSocket,
  requestId: string,
  options: { stopCloudTask?: boolean } = {},
) => {
  const streams = activeStreams.get(ws);
  const stream = streams?.get(requestId);
  if (!stream || !streams) return;

  stream.cancelled = true;
  clearTimers(stream.timers);
  streams.delete(requestId);
  toolPermissionHandlers.delete(requestId);

  if (stream.cloudKey) {
    const [userUuid] = stream.cloudKey.split(':', 2);
    clearCloudTask(stream.cloudKey);
    if (options.stopCloudTask && userUuid) {
      notifyCloudUser(
        userUuid,
        'Cloud task stopped',
        'The task was cancelled.',
        stream.notificationLink ?? DEFAULT_CLOUD_LINK,
        stream.notificationLevel ?? 'always',
        'error',
      );
    }
  }
};

const isMode = (value: unknown): value is AssistantMode =>
  typeof value === 'string' && ASSISTANT_MODES.includes(value as AssistantMode);

const isVariant = (value: unknown): value is AssistantVariant =>
  typeof value === 'string' && ASSISTANT_VARIANTS.includes(value as AssistantVariant);

const startStream = (
  ws: AssistantWebSocket,
  requestId: string,
  mode: AssistantMode,
  variant: AssistantVariant,
  location: AssistantLocation,
  permissionLevel: AssistantPermissionLevel,
  allowedTools: string[],
  notificationLevel: AssistantNotificationLevel,
  chatId: string | undefined,
  messageId: number | undefined,
  prompt: string | undefined,
  userUuid: string,
) => {
  const streams = activeStreams.get(ws);
  if (!streams) return;

  const notificationLink = assistantChatLink(chatId);
  cancelStream(ws, requestId);
  if (streams.size >= MAX_CONCURRENT_STREAMS) {
    send(ws, { type: 'error', requestId, error: 'Too many active streams' });
    if (location === 'cloud' && userUuid) {
      notifyCloudUser(
        userUuid,
        'Cloud task could not start',
        'Too many assistant tasks are already running.',
        notificationLink,
        notificationLevel,
        'error',
      );
    }
    return;
  }

  const mock = createAssistantMockStream(mode, variant);
  const tokens = splitAssistantResponseIntoTokens(mock.content);
  const startedAt = Date.now();
  const thinkingStatuses = new Map<string, AssistantThinkingStatus>();
  const toolSignatures = new Map<string, string>();
  const permissionDecisions = new Map<string, AssistantToolPermissionDecision>();
  const allowedToolNames = new Set(allowedTools);
  const stream: ActiveStream = {
    cancelled: false,
    timers: new Set(),
    notificationLink,
    notificationLevel,
  };
  let index = 0;
  let completed = false;
  let pendingToolId: string | null = null;

  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      stream.timers.delete(timer);
      if (stream.cancelled) return;
      callback();
    }, delay);
    stream.timers.add(timer);
  };

  const needsPermission = (name: string) => {
    if (permissionLevel === 'never-ask') return false;
    if (allowedToolNames.has(name)) return false;
    if (permissionLevel === 'always-ask') return true;
    return SENSITIVE_TOOLS.has(name);
  };

  const stageIndexFor = (length: number) => {
    if (length === 0 || tokens.length === 0) return length - 1;
    return Math.min(length - 1, Math.floor((index / tokens.length) * length));
  };

  const emitThinking = (forceDone = false) => {
    const active = stageIndexFor(mock.thinking.length);
    mock.thinking.forEach((base, stageIndex) => {
      const status: AssistantThinkingStatus = forceDone
        ? 'done'
        : stageIndex < active
          ? 'done'
          : stageIndex === active
            ? 'running'
            : 'pending';
      if (thinkingStatuses.get(base.id) === status) return;
      thinkingStatuses.set(base.id, status);
      send(ws, {
        type: 'thinking',
        requestId,
        step: {
          ...base,
          status,
          durationMs: status === 'done' ? base.durationMs : undefined,
        },
      });
    });
  };

  const emitTool = (
    tool: (typeof mock.tools)[number],
    status: AssistantToolStatus,
    permission?: AssistantToolPermission,
    detail?: string,
  ) => {
    const signature = `${status}|${permission ?? ''}|${detail ?? ''}`;
    if (toolSignatures.get(tool.id) === signature) return;
    toolSignatures.set(tool.id, signature);
    send(ws, {
      type: 'tool',
      requestId,
      tool: {
        ...tool,
        status,
        detail,
        durationMs: status === 'done' ? tool.durationMs : undefined,
        permission,
      },
    });
  };

  const emitTools = (forceDone = false) => {
    const active = stageIndexFor(mock.tools.length);
    mock.tools.forEach((base, stageIndex) => {
      if (pendingToolId !== null && base.id !== pendingToolId) return;

      if (forceDone) {
        const decision = permissionDecisions.get(base.id);
        if (decision === 'deny') {
          emitTool(base, 'denied', 'denied', 'Denied by you');
          return;
        }
        if (decision) {
          const permission = decision === 'allow_always' ? 'allowed_always' : 'allowed_once';
          emitTool(base, 'done', permission);
          return;
        }
        emitTool(base, 'done');
        return;
      }

      if (stageIndex < active) {
        const decision = permissionDecisions.get(base.id);
        const permission = decision
          ? decision === 'allow_always'
            ? 'allowed_always'
            : decision === 'allow_once'
              ? 'allowed_once'
              : 'denied'
          : undefined;
        emitTool(base, decision === 'deny' ? 'denied' : 'done', permission);
        return;
      }

      if (stageIndex !== active || pendingToolId !== null) return;

      if (needsPermission(base.name) && !permissionDecisions.has(base.id)) {
        emitTool(base, 'awaiting_permission', 'pending', 'Waiting for your approval');
        pendingToolId = base.id;
        toolPermissionHandlers.set(requestId, (toolId, decision) => {
          if (toolId !== pendingToolId || stream.cancelled) return;
          pendingToolId = null;
          stream.onOrphaned = undefined;
          toolPermissionHandlers.delete(requestId);
          permissionDecisions.set(toolId, decision);

          if (decision === 'deny') {
            emitTool(base, 'denied', 'denied', 'Denied by you');
            schedule(emitToken, TOKEN_DELAY_MIN_MS);
            return;
          }

          const permission = decision === 'allow_always' ? 'allowed_always' : 'allowed_once';
          const label = decision === 'allow_always' ? 'Allowed always' : 'Allowed once';
          emitTool(base, 'running', permission, label);
          schedule(() => {
            emitTool(base, 'done', permission);
            schedule(emitToken, TOKEN_DELAY_MIN_MS);
          }, base.durationMs ?? 250);
        });
        stream.onOrphaned = () => {
          toolPermissionHandlers.get(requestId)?.(base.id, 'deny');
        };
        send(ws, {
          type: 'tool_permission_request',
          requestId,
          tool: {
            ...base,
            status: 'awaiting_permission',
            detail: 'Waiting for your approval',
            permission: 'pending',
          },
        });
        return;
      }

      emitTool(base, 'running');
    });
  };

  const complete = async () => {
    if (completed) return;
    completed = true;

    emitThinking(true);
    emitTools(true);
    clearTimers(stream.timers);
    streams.delete(requestId);
    toolPermissionHandlers.delete(requestId);

    const durationMs = Math.max(1, Date.now() - startedAt);

    if (stream.cloudKey) {
      clearCloudTask(stream.cloudKey);
      const [completedUserUuid] = stream.cloudKey.split(':', 2);
      if (completedUserUuid) {
        if (stream.orphaned && chatId) {
          const finalTools: AssistantToolCall[] = mock.tools.map((base) => {
            const decision = permissionDecisions.get(base.id);
            if (decision === 'deny') {
              return {
                ...base,
                status: 'denied' as const,
                permission: 'denied' as const,
                detail: 'Denied by you',
              };
            }
            if (decision) {
              return {
                ...base,
                status: 'done' as const,
                permission: decision === 'allow_always' ? ('allowed_always' as const) : ('allowed_once' as const),
              };
            }
            return { ...base, status: 'done' as const };
          });

          await persistCloudResult({
            userUuid: completedUserUuid,
            chatId,
            messageId,
            prompt,
            mode,
            variant,
            content: mock.content,
            thinking: mock.thinking.map((step) => ({ ...step, status: 'done' as const })),
            tools: finalTools,
            durationMs,
            notificationLevel,
            link: notificationLink,
          });
        }

        notifyCloudUser(
          completedUserUuid,
          'Cloud task completed',
          'Your task is finished. Open the assistant to review the result.',
          notificationLink,
          notificationLevel,
          'finish',
        );
      }
    }

    send(ws, {
      type: 'done',
      requestId,
      durationMs,
    });
  };

  const emitToken = () => {
    const token = tokens[index];
    if (token === undefined) {
      void complete();
      return;
    }

    index += 1;
    send(ws, { type: 'token', requestId, token, index: index - 1 });
    emitThinking();
    emitTools();

    if (pendingToolId === null) {
      schedule(emitToken, TOKEN_DELAY_MIN_MS + Math.random() * TOKEN_DELAY_VARY_MS);
    }
  };

  streams.set(requestId, stream);

  if (location === 'cloud') {
    const cloudKey = `${userUuid}:${requestId}`;
    stream.cloudKey = cloudKey;
    const progressSteps = [
      ...mock.thinking.map((step) => step.label),
      ...mock.tools.map((tool) => tool.label ?? tool.name),
    ];
    startCloudTask(cloudKey, userUuid, requestId, progressSteps, notificationLink, notificationLevel);
  }

  emitThinking();
  emitTools();

  if (pendingToolId === null) {
    schedule(emitToken, FIRST_TOKEN_DELAY_MS);
  }
};

const isClientMessage = (value: unknown): value is AssistantStreamClientMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;

  if (message.type === 'auth') {
    return typeof message.token === 'string' && message.token.length <= 512;
  }

  const hasValidRequestId =
    typeof message.requestId === 'string' &&
    Boolean(message.requestId) &&
    message.requestId.length <= 200;
  if (!hasValidRequestId) return false;
  if (
    message.chatId !== undefined &&
    (typeof message.chatId !== 'string' || !message.chatId || message.chatId.length > 200)
  ) {
    return false;
  }
  if (
    message.messageId !== undefined &&
    (typeof message.messageId !== 'number' ||
      !Number.isInteger(message.messageId) ||
      message.messageId < 1 ||
      message.messageId > 1_000_000)
  ) {
    return false;
  }
  if (message.prompt !== undefined && (typeof message.prompt !== 'string' || message.prompt.length > 4000)) {
    return false;
  }

  if (message.type === 'cancel') return true;
  if (message.type === 'tool_permission') {
    return (
      typeof message.toolId === 'string' &&
      Boolean(message.toolId) &&
      message.toolId.length <= 200 &&
      isOneOf(ASSISTANT_TOOL_PERMISSION_DECISIONS, message.decision)
    );
  }
  if (message.type !== 'stream') return false;
  if (message.mode !== undefined && !isMode(message.mode)) return false;
  if (message.variant !== undefined && !isVariant(message.variant)) return false;
  if (message.location !== undefined && !isOneOf(ASSISTANT_LOCATIONS, message.location)) {
    return false;
  }
  if (
    message.permissionLevel !== undefined &&
    !isOneOf(ASSISTANT_PERMISSION_LEVELS, message.permissionLevel)
  ) {
    return false;
  }
  if (
    message.notificationLevel !== undefined &&
    !isOneOf(ASSISTANT_NOTIFICATION_LEVELS, message.notificationLevel)
  ) {
    return false;
  }
  if (
    message.allowedTools !== undefined &&
    (!Array.isArray(message.allowedTools) ||
      message.allowedTools.length > 100 ||
      !message.allowedTools.every(
        (tool) => typeof tool === 'string' && Boolean(tool) && tool.length <= 200,
      ))
  ) {
    return false;
  }
  return true;
};

const handleMessage = async (ws: AssistantWebSocket, raw: string | Buffer<ArrayBuffer>) => {
  const text = typeof raw === 'string' ? raw : raw.toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (!isClientMessage(parsed)) return;

  if (parsed.type === 'auth') {
    if (ws.data.userUuid) return;
    const timer = authTimers.get(ws);
    if (timer) clearTimeout(timer);
    authTimers.delete(ws);

    let user;
    try {
      user = await getUserFromToken(parsed.token);
    } catch {
      user = null;
    }
    if (!user) {
      rejectUnauthenticated(ws, 'Unauthorized');
      return;
    }
    ws.data.userUuid = user.uuid;
    return;
  }

  if (!ws.data.userUuid) {
    rejectUnauthenticated(ws, 'Authentication required');
    return;
  }

  if (parsed.type === 'stream') {
    startStream(
      ws,
      parsed.requestId,
      parsed.mode ?? 'chat',
      parsed.variant ?? 'standard',
      parsed.location ?? 'local',
      parsed.permissionLevel ?? 'always-ask',
      parsed.allowedTools ?? [],
      parsed.notificationLevel ?? 'always',
      parsed.chatId,
      parsed.messageId,
      parsed.prompt,
      ws.data.userUuid,
    );
    return;
  }

  if (parsed.type === 'tool_permission') {
    toolPermissionHandlers.get(parsed.requestId)?.(parsed.toolId, parsed.decision);
    return;
  }

  cancelStream(ws, parsed.requestId);
};

export const assistantWebSocket: WebSocketHandler<AssistantSocketData> = {
  data: undefined as AssistantSocketData | undefined,

  open(ws) {
    activeStreams.set(ws, new Map());
    authTimers.set(
      ws,
      setTimeout(() => rejectUnauthenticated(ws, 'Authentication timed out'), AUTH_TIMEOUT_MS),
    );
  },

  message(ws, raw) {
    // Auth resolution is async, so serialize each socket's messages to keep
    // stream/cancel requests from running before auth has completed.
    const previous = messageQueues.get(ws) ?? Promise.resolve();
    const next = previous.then(() => handleMessage(ws, raw));
    messageQueues.set(ws, next);
    void next.then(
      () => {
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
      () => {
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
    );
  },

  close(ws) {
    const timer = authTimers.get(ws);
    if (timer) clearTimeout(timer);
    authTimers.delete(ws);
    messageQueues.delete(ws);

    const streams = activeStreams.get(ws);
    if (streams) {
      for (const [requestId, stream] of [...streams.entries()]) {
        if (stream.cloudKey) {
          // Cloud tasks deliberately keep running after a socket closes. Mark
          // the stream so completion can persist the result for the deep link.
          stream.orphaned = true;
          // Outstanding permission requests are auto-denied so the task finishes.
          stream.onOrphaned?.();
          stream.onOrphaned = undefined;
          streams.delete(requestId);
          continue;
        }
        cancelStream(ws, requestId);
      }
      activeStreams.delete(ws);
    }
  },
};
