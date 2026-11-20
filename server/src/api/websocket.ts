import type { ServerWebSocket, WebSocketHandler } from 'bun';
import {
  ASSISTANT_MODES,
  ASSISTANT_VARIANTS,
  type AssistantMode,
  type AssistantStreamClientMessage,
  type AssistantStreamErrorCode,
  type AssistantStreamServerMessage,
  type AssistantThinkingStep,
  type AssistantToolCall,
  type AssistantVariant,
} from '@common';
import { getUserFromToken } from './auth';
import { createAssistantMockStream } from '../lib/assistantStream';
import { createRateLimiter } from '../lib/rateLimit';
import { hashToken } from '../lib/tokens';
import {
  assistantActiveStreams,
  assistantRateLimitedTotal,
  assistantResumeTotal,
  assistantStreamDurationSeconds,
  assistantStreamErrorsTotal,
  assistantStreamsTotal,
  assistantStreamTokensTotal,
  assistantThinkingStepsTotal,
  assistantToolCallsTotal,
  assistantWebSocketEventsTotal,
} from '../lib/metrics';

export type AssistantSocketData = {
  userUuid: string | null;
  token: string | null;
  tokenHash: string | null;
  authedAt: number | null;
  clientIp: string;
};

type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type Timer = ReturnType<typeof setTimeout>;

type StreamState = {
  key: string;
  requestId: string;
  userUuid: string;
  mode: AssistantMode;
  variant: AssistantVariant;
  tokens: string[];
  index: number;
  owner: AssistantWebSocket | null;
  timer: Timer | null;
  watchdog: Timer | null;
  startedAt: number;
  status: 'running' | 'done' | 'cancelled' | 'error';
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
  progressEmitted: boolean;
};

const MAX_CONCURRENT_STREAMS = 4;
const AUTH_TIMEOUT_MS = 10_000;
const REAUTH_CHECK_MS = 5 * 60 * 1000;
const RESUME_TTL_MS = 2 * 60 * 1000;
const STREAM_TIMEOUT_MS = 60_000;
const FIRST_TOKEN_DELAY_MS = 300;
const TOKEN_DELAY_MIN_MS = 70;
const TOKEN_DELAY_VARY_MS = 50;

const authLimiter = createRateLimiter(15 * 60_000, 30, 'assistant-ws-auth');
const streamLimiter = createRateLimiter(60_000, 40, 'assistant-ws-stream');
const resumeLimiter = createRateLimiter(60_000, 60, 'assistant-ws-resume');

const streams = new Map<string, StreamState>();
const activeByUser = new Map<string, Set<string>>();
const authTimers = new Map<AssistantWebSocket, Timer>();
const messageQueues = new Map<AssistantWebSocket, Promise<void>>();

const streamKey = (userUuid: string, requestId: string) => `${userUuid}:${requestId}`;

const send = (ws: AssistantWebSocket, message: AssistantStreamServerMessage): boolean => {
  if (ws.readyState !== 1) return false;
  const status = ws.send(JSON.stringify(message));
  assistantWebSocketEventsTotal.inc({
    event: message.type,
    result: status < 0 ? 'backpressure' : status === 0 ? 'dropped' : 'sent',
  });
  return status > 0;
};

const event = (name: string, result = 'ok') => {
  assistantWebSocketEventsTotal.inc({ event: name, result });
};

const trackRateLimit = (limiter: string, allowed: boolean) => {
  assistantRateLimitedTotal.inc({ limiter });
  if (!allowed) event('rate_limited', 'blocked');
};

const clearTimers = (state: StreamState) => {
  if (state.timer) clearTimeout(state.timer);
  if (state.watchdog) clearTimeout(state.watchdog);
  state.timer = null;
  state.watchdog = null;
};

const releaseSlot = (state: StreamState) => {
  const active = activeByUser.get(state.userUuid);
  if (!active?.has(state.requestId)) return;
  active.delete(state.requestId);
  if (active.size === 0) activeByUser.delete(state.userUuid);
  assistantActiveStreams.dec();
};

const takeSlot = (state: StreamState): boolean => {
  const active = activeByUser.get(state.userUuid) ?? new Set<string>();
  if (active.size >= MAX_CONCURRENT_STREAMS) {
    activeByUser.set(state.userUuid, active);
    return false;
  }
  active.add(state.requestId);
  activeByUser.set(state.userUuid, active);
  assistantActiveStreams.inc();
  return true;
};

const rejectUnauthenticated = (
  ws: AssistantWebSocket,
  error: string,
  code: AssistantStreamErrorCode = 'UNAUTHORIZED',
  retryAfterMs?: number,
) => {
  send(ws, { type: 'auth_error', error, code, retryAfterMs });
  assistantStreamErrorsTotal.inc({ code });
  ws.close();
};

const finishStream = (
  state: StreamState,
  message: AssistantStreamServerMessage,
  status: StreamState['status'],
) => {
  clearTimers(state);
  releaseSlot(state);
  state.status = status;
  if (state.owner) send(state.owner, message);
};

const failStream = (state: StreamState, code: AssistantStreamErrorCode, message: string) => {
  if (state.status !== 'running') return;
  assistantStreamErrorsTotal.inc({ code });
  assistantStreamsTotal.inc({
    mode: state.mode,
    variant: state.variant,
    result: 'error',
  });
  finishStream(state, { type: 'error', requestId: state.requestId, error: message, code }, 'error');
  streams.delete(state.key);
};

const cancelState = (state: StreamState, respond: boolean) => {
  if (state.status !== 'running') return;
  clearTimers(state);
  releaseSlot(state);
  state.status = 'cancelled';
  if (respond && state.owner) {
    send(state.owner, { type: 'cancelled', requestId: state.requestId });
  }
  assistantStreamsTotal.inc({ mode: state.mode, variant: state.variant, result: 'cancelled' });
  event('stream_cancelled');
  streams.delete(state.key);
};

const emitThinkingAndTools = (state: StreamState) => {
  for (const step of state.thinking) {
    send(state.owner as AssistantWebSocket, { type: 'thinking', requestId: state.requestId, step });
    assistantThinkingStepsTotal.inc({ status: step.status });
  }
  for (const tool of state.tools) {
    send(state.owner as AssistantWebSocket, { type: 'tool', requestId: state.requestId, tool });
    assistantToolCallsTotal.inc({ name: tool.name, status: tool.status });
  }
};

const emitProgress = (state: StreamState) => {
  if (state.progressEmitted || state.index < Math.floor(state.tokens.length / 2)) return;
  state.progressEmitted = true;

  for (const step of state.thinking) {
    const done: AssistantThinkingStep = { ...step, status: 'done' };
    send(state.owner as AssistantWebSocket, { type: 'thinking', requestId: state.requestId, step: done });
    assistantThinkingStepsTotal.inc({ status: 'done' });
  }

  const tool = state.tools.find((item) => item.id === 'format');
  if (tool) {
    const done: AssistantToolCall = {
      ...tool,
      status: 'done',
      detail: 'Markdown response ready',
      durationMs: Math.max(1, Date.now() - state.startedAt),
    };
    send(state.owner as AssistantWebSocket, { type: 'tool', requestId: state.requestId, tool: done });
    assistantToolCallsTotal.inc({ name: tool.name, status: 'done' });
  }
};

const sendToken = (state: StreamState, index: number) => {
  const token = state.tokens[index];
  if (token === undefined) return false;
  const sent = send(state.owner as AssistantWebSocket, {
    type: 'token',
    requestId: state.requestId,
    token,
    index,
  });
  if (sent) assistantStreamTokensTotal.inc({ mode: state.mode, variant: state.variant });
  return sent;
};

const completeStream = (state: StreamState) => {
  const durationMs = Math.max(1, Date.now() - state.startedAt);
  assistantStreamDurationSeconds.observe(
    { mode: state.mode, variant: state.variant },
    durationMs / 1000,
  );
  assistantStreamsTotal.inc({ mode: state.mode, variant: state.variant, result: 'done' });
  finishStream(
    state,
    { type: 'done', requestId: state.requestId, durationMs },
    'done',
  );
  streams.delete(state.key);
};

const scheduleToken = (state: StreamState, delayMs: number) => {
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.status !== 'running' || !state.owner) return;

    if (state.index >= state.tokens.length) {
      completeStream(state);
      return;
    }

    const index = state.index;
    if (!sendToken(state, index)) {
      failStream(state, 'SERVER_ERROR', 'Failed to deliver response token');
      return;
    }
    state.index += 1;
    emitProgress(state);
    scheduleToken(state, TOKEN_DELAY_MIN_MS + Math.random() * TOKEN_DELAY_VARY_MS);
  }, delayMs);
};

const startStream = (
  ws: AssistantWebSocket,
  requestId: string,
  mode: AssistantMode,
  variant: AssistantVariant,
) => {
  const userUuid = ws.data.userUuid;
  if (!userUuid) return;

  const key = streamKey(userUuid, requestId);
  const existing = streams.get(key);
  if (existing) cancelState(existing, false);

  const mock = createAssistantMockStream(mode);
  const state: StreamState = {
    key,
    requestId,
    userUuid,
    mode,
    variant,
    tokens: mock.tokens,
    index: 0,
    owner: ws,
    timer: null,
    watchdog: null,
    startedAt: Date.now(),
    status: 'running',
    thinking: mock.thinking,
    tools: mock.tools,
    progressEmitted: false,
  };

  if (!takeSlot(state)) {
    send(ws, {
      type: 'error',
      requestId,
      error: 'Too many active assistant streams. Cancel one and try again.',
      code: 'STREAM_LIMIT',
    });
    assistantStreamErrorsTotal.inc({ code: 'STREAM_LIMIT' });
    return;
  }

  streams.set(key, state);
  state.watchdog = setTimeout(
    () => failStream(state, 'STREAM_TIMEOUT', 'Assistant response timed out'),
    STREAM_TIMEOUT_MS,
  );

  emitThinkingAndTools(state);
  scheduleToken(state, FIRST_TOKEN_DELAY_MS);
};

const resumeStream = (ws: AssistantWebSocket, requestId: string, lastTokenIndex: number) => {
  const userUuid = ws.data.userUuid;
  if (!userUuid) return;

  const key = streamKey(userUuid, requestId);
  const state = streams.get(key);
  if (!state || state.status !== 'running') {
    send(ws, {
      type: 'error',
      requestId,
      error: 'This response can no longer be resumed.',
      code: 'RESUME_UNAVAILABLE',
    });
    assistantStreamErrorsTotal.inc({ code: 'RESUME_UNAVAILABLE' });
    assistantResumeTotal.inc({ result: 'unavailable' });
    return;
  }

  if (state.owner && state.owner !== ws) {
    clearTimers(state);
    state.owner = ws;
  } else if (!state.owner && !takeSlot(state)) {
    send(ws, {
      type: 'error',
      requestId,
      error: 'Too many active assistant streams. Cancel one and try again.',
      code: 'STREAM_LIMIT',
    });
    assistantStreamErrorsTotal.inc({ code: 'STREAM_LIMIT' });
    assistantResumeTotal.inc({ result: 'limited' });
    return;
  } else {
    state.owner = ws;
  }

  const replayFrom = Math.max(0, Math.min(lastTokenIndex + 1, state.index));
  for (let index = replayFrom; index < state.index; index++) {
    sendToken(state, index);
  }

  send(ws, { type: 'resumed', requestId, nextIndex: state.index });
  assistantResumeTotal.inc({ result: 'resumed' });
  event('stream_resumed');

  state.watchdog = setTimeout(
    () => failStream(state, 'STREAM_TIMEOUT', 'Assistant response timed out'),
    STREAM_TIMEOUT_MS,
  );
  scheduleToken(state, TOKEN_DELAY_MIN_MS);
};

const cancelStream = (ws: AssistantWebSocket, requestId: string) => {
  const userUuid = ws.data.userUuid;
  if (!userUuid) return;
  const state = streams.get(streamKey(userUuid, requestId));
  if (!state) return;
  cancelState(state, state.owner === ws);
};

const releaseSocketStreams = (ws: AssistantWebSocket, cancel: boolean) => {
  for (const state of streams.values()) {
    if (state.owner === ws) {
      if (cancel) cancelState(state, false);
      else {
        clearTimers(state);
        releaseSlot(state);
        state.owner = null;
        event('stream_orphaned');
      }
    }
  }
};

const isClientMessage = (value: unknown): value is AssistantStreamClientMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;

  if (message.type === 'auth') {
    return typeof message.token === 'string' && message.token.length > 0 && message.token.length <= 512;
  }

  if (message.type === 'stream') {
    return (
      typeof message.requestId === 'string' &&
      Boolean(message.requestId) &&
      message.requestId.length <= 200 &&
      typeof message.mode === 'string' &&
      ASSISTANT_MODES.includes(message.mode as AssistantMode) &&
      typeof message.variant === 'string' &&
      ASSISTANT_VARIANTS.includes(message.variant as AssistantVariant)
    );
  }

  if (message.type === 'resume') {
    return (
      typeof message.requestId === 'string' &&
      Boolean(message.requestId) &&
      message.requestId.length <= 200 &&
      typeof message.lastTokenIndex === 'number' &&
      Number.isInteger(message.lastTokenIndex) &&
      message.lastTokenIndex >= -1 &&
      message.lastTokenIndex <= 100_000
    );
  }

  return (
    message.type === 'cancel' &&
    typeof message.requestId === 'string' &&
    Boolean(message.requestId) &&
    message.requestId.length <= 200
  );
};

const revalidateAuth = async (ws: AssistantWebSocket): Promise<boolean> => {
  if (!ws.data.token) return false;
  const authedAt = ws.data.authedAt ?? 0;
  if (Date.now() - authedAt < REAUTH_CHECK_MS) return true;

  try {
    const user = await getUserFromToken(ws.data.token);
    if (!user) return false;
    ws.data.userUuid = user.uuid;
    ws.data.authedAt = Date.now();
    return true;
  } catch {
    return false;
  }
};

const handleMessage = async (ws: AssistantWebSocket, raw: string | Buffer<ArrayBuffer>) => {
  const text = typeof raw === 'string' ? raw : raw.toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    event('invalid_message', 'rejected');
    return;
  }
  if (!isClientMessage(parsed)) {
    event('invalid_message', 'rejected');
    return;
  }

  if (parsed.type === 'auth') {
    const rate = await authLimiter.check(`ip:${ws.data.clientIp || 'unknown'}:token:${hashToken(parsed.token)}`);
    trackRateLimit('assistant-ws-auth', rate.allowed);
    if (!rate.allowed) {
      rejectUnauthenticated(ws, 'Too many authentication attempts', 'RATE_LIMITED', rate.retryAfterMs);
      return;
    }

    const authTimer = authTimers.get(ws);
    if (authTimer) clearTimeout(authTimer);
    authTimers.delete(ws);

    let user;
    try {
      user = await getUserFromToken(parsed.token);
    } catch {
      user = null;
    }
    if (!user) {
      rejectUnauthenticated(ws, 'Unauthorized', 'UNAUTHORIZED');
      return;
    }

    if (ws.data.userUuid && ws.data.userUuid !== user.uuid) {
      releaseSocketStreams(ws, true);
    }

    ws.data.userUuid = user.uuid;
    ws.data.token = parsed.token;
    ws.data.tokenHash = hashToken(parsed.token);
    ws.data.authedAt = Date.now();
    send(ws, { type: 'auth_ok' });
    event('auth', 'ok');
    return;
  }

  if (!ws.data.userUuid || !(await revalidateAuth(ws))) {
    rejectUnauthenticated(ws, 'Authentication required', 'UNAUTHORIZED');
    return;
  }

  if (parsed.type === 'stream') {
    const rate = await streamLimiter.check(`user:${ws.data.userUuid}`);
    trackRateLimit('assistant-ws-stream', rate.allowed);
    if (!rate.allowed) {
      send(ws, {
        type: 'error',
        requestId: parsed.requestId,
        error: 'Too many assistant requests. Try again shortly.',
        code: 'RATE_LIMITED',
        retryAfterMs: rate.retryAfterMs,
      });
      assistantStreamErrorsTotal.inc({ code: 'RATE_LIMITED' });
      return;
    }
    startStream(ws, parsed.requestId, parsed.mode, parsed.variant);
    return;
  }

  if (parsed.type === 'resume') {
    const rate = await resumeLimiter.check(`user:${ws.data.userUuid}`);
    trackRateLimit('assistant-ws-resume', rate.allowed);
    if (!rate.allowed) {
      send(ws, {
        type: 'error',
        requestId: parsed.requestId,
        error: 'Too many reconnect attempts. Try again shortly.',
        code: 'RATE_LIMITED',
        retryAfterMs: rate.retryAfterMs,
      });
      assistantStreamErrorsTotal.inc({ code: 'RATE_LIMITED' });
      assistantResumeTotal.inc({ result: 'limited' });
      return;
    }
    resumeStream(ws, parsed.requestId, parsed.lastTokenIndex);
    return;
  }

  cancelStream(ws, parsed.requestId);
};

export const assistantWebSocket: WebSocketHandler<AssistantSocketData> = {
  data: undefined as AssistantSocketData | undefined,
  maxPayloadLength: 4096,
  idleTimeout: 120,
  sendPings: true,
  closeOnBackpressureLimit: false,

  open(ws) {
    ws.data.userUuid = null;
    ws.data.token = null;
    ws.data.tokenHash = null;
    ws.data.authedAt = null;
    authTimers.set(
      ws,
      setTimeout(
        () => rejectUnauthenticated(ws, 'Authentication timed out', 'AUTH_TIMEOUT'),
        AUTH_TIMEOUT_MS,
      ),
    );
    event('open');
  },

  message(ws, raw) {
    // Auth and rate-limit checks are async; serialize messages so a stream
    // request can never overtake the auth message that precedes it.
    const previous = messageQueues.get(ws) ?? Promise.resolve();
    const next = previous.then(() => handleMessage(ws, raw));
    messageQueues.set(ws, next);
    void next.then(
      () => {
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
      () => {
        event('handler_error', 'error');
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
    );
  },

  drain(ws) {
    event('drain');
    void ws;
  },

  close(ws) {
    const authTimer = authTimers.get(ws);
    if (authTimer) clearTimeout(authTimer);
    authTimers.delete(ws);
    messageQueues.delete(ws);
    releaseSocketStreams(ws, false);
    event('close');
  },
};

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const state of streams.values()) {
    if (
      (state.status !== 'running' && (state.timer || state.watchdog)) ||
      (state.owner === null && now - state.startedAt > RESUME_TTL_MS)
    ) {
      clearTimers(state);
      releaseSlot(state);
      streams.delete(state.key);
    }
  }
}, 30_000);
cleanup.unref?.();
