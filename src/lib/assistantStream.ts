import { ASSISTANT_STREAM_PATH, type AssistantStreamClientMessage, type AssistantStreamServerMessage } from '@common';
import { API_BASE_URL, api } from './api';

export type AssistantStreamHandlers = {
  onToken: (requestId: string, token: string) => void;
  onDone: (requestId: string) => void;
  onError?: (requestId: string, error: string) => void;
};

const isServerMessage = (value: unknown): value is AssistantStreamServerMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'auth_error') return typeof message.error === 'string';
  if (typeof message.requestId !== 'string') return false;
  if (message.type === 'token') return typeof message.token === 'string';
  if (message.type === 'done') return true;
  return message.type === 'error' && typeof message.error === 'string';
};

export class AssistantStreamClient {
  private readonly url: string;
  private readonly handlers: AssistantStreamHandlers;
  private socket: WebSocket | null = null;
  private pending: AssistantStreamClientMessage[] = [];
  private readonly active = new Set<string>();

  constructor(handlers: AssistantStreamHandlers) {
    this.handlers = handlers;
    const base = API_BASE_URL.replace(/^http/, 'ws');
    this.url = `${base}${ASSISTANT_STREAM_PATH}`;
  }

  private connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: api.getAuthToken() ?? '' }));
      const queued = this.pending;
      this.pending = [];
      for (const message of queued) socket.send(JSON.stringify(message));
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

      if (parsed.type === 'auth_error') {
        this.close();
        const requestIds = [...this.active];
        this.active.clear();
        for (const requestId of requestIds) {
          this.handlers.onError?.(requestId, parsed.error);
        }
        return;
      }

      if (parsed.type === 'token') {
        this.handlers.onToken(parsed.requestId, parsed.token);
        return;
      }
      this.active.delete(parsed.requestId);
      if (parsed.type === 'done') this.handlers.onDone(parsed.requestId);
      else this.handlers.onError?.(parsed.requestId, parsed.error);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.pending = [];
      if (this.active.size === 0) return;
      const requestIds = [...this.active];
      this.active.clear();
      for (const requestId of requestIds) {
        this.handlers.onError?.(requestId, 'Stream disconnected');
      }
    };
  }

  private send(message: AssistantStreamClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
    this.connect();
  }

  stream(requestId: string) {
    this.active.add(requestId);
    this.send({ type: 'stream', requestId });
  }

  cancel(requestId: string) {
    this.send({ type: 'cancel', requestId });
  }

  close() {
    this.pending = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}
