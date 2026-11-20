import type { ServerWebSocket, WebSocketHandler } from 'bun';
import type {
  AssistantStreamClientMessage,
  AssistantStreamServerMessage,
} from '@common';
import {
  generateAssistantResponse,
  splitAssistantResponseIntoTokens,
} from '../lib/assistantStream';

export type AssistantSocketData = { userUuid: string };
type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type ActiveStreams = Map<string, ReturnType<typeof setTimeout>>;

const MAX_CONCURRENT_STREAMS = 8;
const FIRST_TOKEN_DELAY_MS = 300;
const TOKEN_DELAY_MIN_MS = 70;
const TOKEN_DELAY_VARY_MS = 50;

const activeStreams = new Map<AssistantWebSocket, ActiveStreams>();

const send = (ws: AssistantWebSocket, message: AssistantStreamServerMessage) => {
  ws.send(JSON.stringify(message));
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
  if (typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 200) {
    return false;
  }
  return message.type === 'stream' || message.type === 'cancel';
};

export const assistantWebSocket: WebSocketHandler<AssistantSocketData> = {
  data: undefined as AssistantSocketData | undefined,

  open(ws) {
    activeStreams.set(ws, new Map());
  },

  message(ws, raw) {
    const text = typeof raw === 'string' ? raw : raw.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;

    if (parsed.type === 'stream') startStream(ws, parsed.requestId);
    else cancelStream(ws, parsed.requestId);
  },

  close(ws) {
    const streams = activeStreams.get(ws);
    if (streams) {
      for (const timer of streams.values()) clearTimeout(timer);
      activeStreams.delete(ws);
    }
  },
};
