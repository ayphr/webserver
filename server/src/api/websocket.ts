import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type {
  AssistantStreamClientMessage,
  AssistantStreamServerMessage,
} from '@common';
import {
  generateAssistantResponse,
  splitAssistantResponseIntoTokens,
} from '../lib/assistantStream';
import { getUserFromToken } from './auth';

export type AssistantSocketData = { userUuid: string | null };
type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type ActiveStreams = Map<string, ReturnType<typeof setTimeout>>;

const MAX_CONCURRENT_STREAMS = 8;
const AUTH_TIMEOUT_MS = 10_000;
const FIRST_TOKEN_DELAY_MS = 300;
const TOKEN_DELAY_MIN_MS = 70;
const TOKEN_DELAY_VARY_MS = 50;

const activeStreams = new Map<AssistantWebSocket, ActiveStreams>();
const authTimers = new Map<AssistantWebSocket, ReturnType<typeof setTimeout>>();
const messageQueues = new Map<AssistantWebSocket, Promise<void>>();

const send = (ws: AssistantWebSocket, message: AssistantStreamServerMessage) => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(message));
};

const rejectUnauthenticated = (ws: AssistantWebSocket, error: string) => {
  send(ws, { type: 'auth_error', error });
  ws.close();
};

const cancelStream = (ws: AssistantWebSocket, requestId: string) => {
  const streams = activeStreams.get(ws);
  if (!streams) return;
  const timer = streams.get(requestId);
  if (timer) clearTimeout(timer);
  streams.delete(requestId);
};

const startStream = (ws: AssistantWebSocket, requestId: string) => {
  const streams = activeStreams.get(ws);
  if (!streams) return;

  cancelStream(ws, requestId);
  if (streams.size >= MAX_CONCURRENT_STREAMS) {
    send(ws, { type: 'error', requestId, error: 'Too many active streams' });
    return;
  }

  const tokens = splitAssistantResponseIntoTokens(generateAssistantResponse());
  let index = 0;

  const emitToken = () => {
    if (index >= tokens.length) {
      streams.delete(requestId);
      send(ws, { type: 'done', requestId });
      return;
    }

    const token = tokens[index];
    if (token === undefined) {
      streams.delete(requestId);
      send(ws, { type: 'done', requestId });
      return;
    }
    index += 1;
    send(ws, { type: 'token', requestId, token });
    const timer = setTimeout(emitToken, TOKEN_DELAY_MIN_MS + Math.random() * TOKEN_DELAY_VARY_MS);
    streams.set(requestId, timer);
  };

  const timer = setTimeout(emitToken, FIRST_TOKEN_DELAY_MS);
  streams.set(requestId, timer);
};

const isClientMessage = (value: unknown): value is AssistantStreamClientMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;

  if (message.type === 'auth') {
    return typeof message.token === 'string' && message.token.length <= 512;
  }
  if (message.type !== 'stream' && message.type !== 'cancel') return false;
  return (
    typeof message.requestId === 'string' &&
    Boolean(message.requestId) &&
    message.requestId.length <= 200
  );
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

  if (parsed.type === 'stream') startStream(ws, parsed.requestId);
  else cancelStream(ws, parsed.requestId);
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
      for (const streamTimer of streams.values()) clearTimeout(streamTimer);
      activeStreams.delete(ws);
    }
  },
};
