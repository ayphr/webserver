import type {
  AssistantMode,
  AssistantStreamClientMessage,
  AssistantStreamErrorCode,
  AssistantStreamServerMessage,
  AssistantThinkingStep,
  AssistantToolCall,
  AssistantVariant,
} from '@common';
import { ASSISTANT_STREAM_PATH } from '@common';
import { API_BASE_URL, api } from './api';

export type AssistantStreamHandlers = {
  onAuthOk?: () => void;
  onToken: (requestId: string, token: string, index: number) => void;
  onDone: (requestId: string, durationMs: number) => void;
  onError: (
    requestId: string,
    error: string,
    code?: AssistantStreamErrorCode,
    retryAfterMs?: number,
  ) => void;
  onThinking?: (requestId: string, step: AssistantThinkingStep) => void;
  onTool?: (requestId: string, tool: AssistantToolCall) => void;
  onResumed?: (requestId: string, nextIndex: number) => void;
};

type StreamProgress = {
  lastIndex: number;
  reconnectAttempts: number;
};

const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_PENDING_MESSAGES = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isServerMessage = (value: unknown): value is AssistantStreamServerMessage => {
  if (!isRecord(value)) return false;
  if (value.type === 'auth_ok') return true;
  if (value.type === 'auth_error') {
    return typeof value.error === 'string' && typeof value.requestId !== 'string';
  }
  if (typeof value.requestId !== 'string') return false;

  if (value.type === 'token') {
    return typeof value.token === 'string' && typeof value.index === 'number';
  }
  if (value.type === 'done') return typeof value.durationMs === 'number';
  if (value.type === 'resumed') return typeof value.nextIndex === 'number';
  if (value.type === 'cancelled') return true;
  if (value.type === 'error') return typeof value.error === 'string';
  if (value.type === 'thinking') {
    return isRecord(value.step) && typeof value.step.title === 'string';
  }
  if (value.type === 'tool') {
    return isRecord(value.tool) && typeof value.tool.name === 'string';
  }
  return false;
};

export class AssistantStreamClient {
  private readonly url: string;
  private readonly handlers: AssistantStreamHandlers;
  private socket: WebSocket | null = null;
  private pending: AssistantStreamClientMessage[] = [];
  private readonly active = new Set<string>();
  private readonly progress = new Map<string, StreamProgress>();
  private readonly resumePending = new Set<string>();
  private authTokenUsed: string | null = null;
  private authenticated = false;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private retryAfterMs = 0;
  private authRetryAttempted = false;

  constructor(handlers: AssistantStreamHandlers) {
    this.handlers = handlers;
    const base = API_BASE_URL.replace(/^http/, 'ws');
    this.url = `${base}${ASSISTANT_STREAM_PATH}`;
  }

  private connect() {
    if (this.manualClose) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = api.getAuthToken() ?? '';
    this.authTokenUsed = token;
    this.authenticated = false;

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'auth', token: api.getAuthToken() ?? '' }));
      this.flushPending(socket);
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isServerMessage(parsed)) return;
      this.handleServerMessage(parsed);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.authenticated = false;
      if (this.manualClose) return;

      for (const requestId of this.active) {
        const progress = this.progress.get(requestId);
        if (progress) progress.reconnectAttempts += 1;
        this.resumePending.add(requestId);
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows onerror; reconnect is handled there.
    };
  }

  private flushPending(socket: WebSocket) {
    const queued = this.pending;
    this.pending = [];
    for (const message of queued) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      else this.pending.push(message);
    }
  }

  private scheduleReconnect() {
    if (this.manualClose || this.reconnectTimer) return;
    if (this.active.size === 0 && this.pending.length === 0 && this.resumePending.size === 0) {
      // Keep the client ready for the next request without hammering the
      // server while the app is idle.
      this.reconnectAttempts = 0;
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts = 0;
      const requestIds = [...this.active];
      this.active.clear();
      this.progress.clear();
      this.resumePending.clear();
      for (const requestId of requestIds) {
        this.handlers.onError(requestId, 'Stream disconnected', 'SERVER_ERROR');
      }
      return;
    }

    const exponential = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    const jitter = Math.random() * 250;
    const delayMs = Math.max(exponential + jitter, this.retryAfterMs);
    this.retryAfterMs = 0;
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private forceReconnect() {
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.connect();
  }

  private send(message: AssistantStreamClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    if (this.pending.length >= MAX_PENDING_MESSAGES) return;
    this.pending.push(message);
    this.connect();
  }

  private failActive(error: string, code?: AssistantStreamErrorCode, retryAfterMs?: number) {
    const requestIds = [...this.active];
    this.active.clear();
    this.progress.clear();
    this.resumePending.clear();
    for (const requestId of requestIds) {
      this.handlers.onError(requestId, error, code, retryAfterMs);
    }
  }

  private handleAuthError(message: Extract<AssistantStreamServerMessage, { type: 'auth_error' }>) {
    const currentToken = api.getAuthToken() ?? '';
    if (
      !this.authRetryAttempted &&
      currentToken !== this.authTokenUsed &&
      message.code !== 'RATE_LIMITED'
    ) {
      this.authRetryAttempted = true;
      this.forceReconnect();
      return;
    }

    this.failActive(message.error, message.code ?? 'UNAUTHORIZED', message.retryAfterMs);
    this.manualClose = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.manualClose = false;
  }

  private handleServerMessage(message: AssistantStreamServerMessage) {
    if (message.type === 'auth_ok') {
      this.authenticated = true;
      this.authRetryAttempted = false;
      this.reconnectAttempts = 0;
      const socket = this.socket;
      if (socket) this.flushPending(socket);

      for (const requestId of this.resumePending) {
        const lastIndex = this.progress.get(requestId)?.lastIndex ?? -1;
        this.send({ type: 'resume', requestId, lastTokenIndex: lastIndex });
      }
      this.resumePending.clear();
      this.handlers.onAuthOk?.();
      return;
    }

    if (message.type === 'auth_error') {
      this.handleAuthError(message);
      return;
    }

    const requestId = message.requestId;

    if (message.type === 'token') {
      const progress = this.progress.get(requestId);
      if (!progress || message.index <= progress.lastIndex) return;
      progress.lastIndex = message.index;
      this.handlers.onToken(requestId, message.token, message.index);
      return;
    }

    if (message.type === 'thinking') {
      this.handlers.onThinking?.(requestId, message.step);
      return;
    }
    if (message.type === 'tool') {
      this.handlers.onTool?.(requestId, message.tool);
      return;
    }
    if (message.type === 'resumed') {
      const progress = this.progress.get(requestId);
      if (progress) progress.lastIndex = Math.max(progress.lastIndex, message.nextIndex - 1);
      this.handlers.onResumed?.(requestId, message.nextIndex);
      return;
    }
    if (message.type === 'cancelled') return;

    this.active.delete(requestId);
    this.progress.delete(requestId);
    this.resumePending.delete(requestId);

    if (message.type === 'done') {
      this.handlers.onDone(requestId, message.durationMs);
      return;
    }
    this.retryAfterMs = message.retryAfterMs ?? 0;
    this.handlers.onError(requestId, message.error, message.code, message.retryAfterMs);
  }

  stream(
    requestId: string,
    options: { mode: AssistantMode; variant: AssistantVariant },
  ) {
    this.active.add(requestId);
    this.progress.set(requestId, { lastIndex: -1, reconnectAttempts: 0 });
    this.resumePending.delete(requestId);
    this.send({ type: 'stream', requestId, mode: options.mode, variant: options.variant });
  }

  resume(requestId: string, lastTokenIndex: number) {
    this.active.add(requestId);
    this.progress.set(requestId, { lastIndex: lastTokenIndex, reconnectAttempts: 0 });
    if (this.authenticated) {
      this.send({ type: 'resume', requestId, lastTokenIndex });
    } else {
      this.resumePending.add(requestId);
      this.connect();
    }
  }

  cancel(requestId: string) {
    this.active.delete(requestId);
    this.progress.delete(requestId);
    this.resumePending.delete(requestId);
    this.send({ type: 'cancel', requestId });
  }

  close() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.active.clear();
    this.progress.clear();
    this.resumePending.clear();
    this.pending = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}
