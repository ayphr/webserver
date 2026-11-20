import { expect, mock, test } from 'bun:test';
import type { AssistantSocketData } from './websocket';

mock.module('./auth', () => ({
  getUserFromToken: async (token: string) =>
    token === 'invalid' ? null : { uuid: `user-${token}` },
}));

const { assistantWebSocket } = await import('./websocket');

type ServerMessage = Record<string, unknown> & { type: string };

const startServer = () =>
  Bun.serve<AssistantSocketData>({
    port: 0,
    websocket: assistantWebSocket,
    fetch(request, server) {
      if (
        server.upgrade(request, {
          data: {
            userUuid: null,
            token: null,
            tokenHash: null,
            authedAt: null,
            clientIp: '127.0.0.1',
          },
        })
      ) {
        return undefined;
      }
      return new Response('bad', { status: 400 });
    },
  });

const connect = (port: number) => new WebSocket(`ws://localhost:${port}`);

const requirePort = (server: ReturnType<typeof startServer>): number => {
  if (server.port === undefined) throw new Error('test server has no port');
  return server.port;
};

const waitForMessage = (
  ws: WebSocket,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs = 3000,
) =>
  new Promise<ServerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
    const handler = (event: MessageEvent) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(message);
    };
    ws.addEventListener('message', handler);
  });

const authAndStream = async (ws: WebSocket, token: string, requestId: string) => {
  const tokenMessage = waitForMessage(ws, (message) => message.type === 'token');
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
    ws.send(
      JSON.stringify({
        type: 'stream',
        requestId,
        mode: 'chat',
        variant: 'standard',
      }),
    );
  };
  return tokenMessage;
};

test('authorizes before streaming tokens and stops on cancel', async () => {
  const server = startServer();
  const ws = connect(requirePort(server));

  try {
    const firstToken = await authAndStream(ws, 'cancel-test', 'request-1');
    expect(firstToken.type).toBe('token');
    expect(firstToken.index).toBe(0);
    expect(typeof firstToken.token).toBe('string');

    const tokens: number[] = [Number(firstToken.index)];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === 'token') tokens.push(Number(message.index));
    };

    ws.send(JSON.stringify({ type: 'cancel', requestId: 'request-1' }));
    const countAfterCancel = tokens.length;
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(tokens.length).toBe(countAfterCancel);
  } finally {
    ws.close();
    server.stop(true);
  }
});

test('resumes a stream after disconnect without repeating acknowledged tokens', async () => {
  const server = startServer();
  const first = connect(requirePort(server));
  const tokenTwo = waitForMessage(first, (message) => message.type === 'token' && message.index === 1);

  try {
    await authAndStream(first, 'resume-test', 'request-2');
    await tokenTwo;
    first.close();

    const second = connect(requirePort(server));
    const resumed = waitForMessage(second, (message) => message.type === 'resumed');
    const replayed = waitForMessage(
      second,
      (message) => message.type === 'token' && message.index === 2,
    );
    const replayedIndexes: number[] = [];

    second.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === 'token') replayedIndexes.push(Number(message.index));
    };

    second.onopen = () => {
      second.send(JSON.stringify({ type: 'auth', token: 'resume-test' }));
      second.send(JSON.stringify({ type: 'resume', requestId: 'request-2', lastTokenIndex: 0 }));
    };

    expect((await resumed).type).toBe('resumed');
    await replayed;
    expect(replayedIndexes.some((index) => index <= 0)).toBe(false);
    expect(replayedIndexes).toContain(1);

    second.send(JSON.stringify({ type: 'cancel', requestId: 'request-2' }));
    second.close();
  } finally {
    first.close();
    server.stop(true);
  }
});
