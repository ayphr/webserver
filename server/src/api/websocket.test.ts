import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AssistantModelDraft, AssistantModelRequest, AssistantModelStreamHandlers } from '../lib/assistantModel';
import type { AssistantToolResult } from '@common';

type Sent = Record<string, any>;

const sent: Sent[] = [];
let nextDraft: (request: AssistantModelRequest, round: number) => AssistantModelDraft;
let toolExecutor: (
  name: string,
  input: Record<string, unknown>,
) => Promise<AssistantToolResult>;
let rounds = 0;
let lastSignal: AbortSignal | undefined;
let deltaSpy: ((chunks: string[]) => void) | undefined;
const auditEntries: Record<string, any>[] = [];

const createAdapter = () => ({
  id: 'test-gemini',
  generate: async (
    request: AssistantModelRequest,
    handlers?: AssistantModelStreamHandlers,
  ): Promise<AssistantModelDraft> => {
    lastSignal = request.signal;
    const round = rounds++;
    const draft = nextDraft(request, round);
    const chunks: string[] = [];
    if (handlers?.onTextDelta && draft.content) {
      // Split into a couple of chunks to exercise live delta forwarding.
      const mid = Math.max(1, Math.floor(draft.content.length / 2));
      chunks.push(draft.content.slice(0, mid), draft.content.slice(mid));
      for (const chunk of chunks) handlers.onTextDelta(chunk);
    }
    deltaSpy?.(chunks);
    return draft;
  },
});

const adapter = createAdapter();

mock.module('./auth', () => ({
  getUserFromToken: async () => ({ uuid: 'user-1', teamId: 'team-1' }),
}));
mock.module('../lib/assistantModel', () => ({
  getAssistantModelAdapter: () => adapter,
}));
mock.module('../lib/assistantTools', () => ({
  executeAssistantTool: (
    name: string,
    options: { input: Record<string, unknown> },
  ) => toolExecutor(name, options.input),
}));
mock.module('../lib/db/assistant', () => ({
  getAssistantState: async () => null,
  saveStreamResult: async () => {},
  updateAssistantChatContext: async () => {},
}));
mock.module('../lib/credits', () => ({
  getCreditBalanceFromUuid: async () => ({ available: 100, total: 100, onHold: 0 }),
  holdCredits: async () => ({ changed: true }),
  releaseCredits: async () => ({ changed: true }),
  consumeCredits: async () => ({ changed: true }),
}));
mock.module('../lib/notifications', () => ({
  notifyUser: async () => {},
}));
mock.module('../lib/backgroundTasks', () => ({
  runBackgroundTask: (_name: string, task: () => Promise<void>) => {
    void task();
  },
}));
mock.module('../lib/db', () => ({
  getUserFromUuid: async () => ({ uuid: 'user-1', username: 'tester', teamId: 'team-1' }),
}));
mock.module('../lib/db/teams', () => ({
  getTeamForUser: async () => ({ id: 'team-1' }),
}));
mock.module('../lib/teamAuditService', () => ({
  logTeamAudit: async (entry: Record<string, any>) => {
    auditEntries.push(entry);
    return { ...entry, id: 'audit-1', createdAt: new Date() };
  },
}));

const { assistantWebSocket } = await import('./websocket');

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for stream');
    await Bun.sleep(5);
  }
};

const createSocket = () => {
  const socket: Record<string, any> = {
    data: { userUuid: null },
    readyState: 1,
    send: (raw: string) => {
      sent.push(JSON.parse(raw) as Sent);
    },
    close: () => {
      socket.readyState = 3;
    },
  };
  return socket as any;
};

const messagesOf = (type: string) => sent.filter((message) => message.type === type);

const plainDraft = (content: string): AssistantModelDraft => ({
  content,
  thinking: [],
  tools: [],
  usage: { inputTokens: 10, outputTokens: 5 },
});

describe('assistant websocket streaming', () => {
  beforeEach(() => {
    sent.length = 0;
    rounds = 0;
    lastSignal = undefined;
    deltaSpy = undefined;
    auditEntries.length = 0;
    nextDraft = () => plainDraft('Hello from Iris');
    toolExecutor = async () => ({
      toolId: 'call-1',
      name: 'devices.list',
      status: 'ok',
      summary: 'Found 0 devices',
      data: { devices: [] },
    });
  });

  it('emits live text deltas immediately and finishes with a credit cost', async () => {
    const seenDeltas: string[][] = [];
    deltaSpy = (chunks) => seenDeltas.push(chunks);
    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);

    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-1',
        mode: 'chat',
        variant: 'standard',
        prompt: 'Say hello',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(seenDeltas.flat()).toEqual(['Hello f', 'rom Iris']);
    const tokens = messagesOf('token');
    expect(tokens.map((message) => message.token).join('')).toBe('Hello from Iris');
    expect(tokens.map((message) => message.index)).toEqual([0, 1, 2]);
    expect(messagesOf('error')).toHaveLength(0);
    const done = messagesOf('done')[0]!;
    expect(done.durationMs).toBeGreaterThan(0);
    expect(done.creditCost).toBeGreaterThan(0);
  });

  it('preserves whitespace at live stream chunk boundaries', async () => {
    const content = `${'a'.repeat(40)} ${'b'.repeat(40)}`;
    nextDraft = () => plainDraft(content);

    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-boundary', prompt: 'hi', mode: 'chat' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('token').map((message) => message.token).join('')).toBe(content);
  });

  it('reserves credits before calling the model and settles on completion', async () => {
    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-2', prompt: 'hi', mode: 'chat' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    const context = messagesOf('context')[0]!;
    expect(context.usage.usedTokens).toBeGreaterThan(0);
    expect(rounds).toBe(1);
  });

  it('continues after a tool round and appends the second draft', async () => {
    nextDraft = (request, round) => {
      if (round === 0) {
        return {
          content: '',
          thinking: [],
          tools: [
            {
              id: 'call-1',
              name: 'devices.list',
              label: 'List devices',
              status: 'pending',
              input: {},
              durationMs: 0,
            },
          ],
          usage: { inputTokens: 10, outputTokens: 2 },
          continuation: { steps: [{ type: 'function_call', id: 'call-1', name: 'devices.list' }] },
        };
      }
      expect(request.toolResults?.[0]?.name).toBe('devices.list');
      return plainDraft('You have no devices.');
    };

    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-3',
        prompt: 'What devices do I have?',
        mode: 'task',
        permissionLevel: 'never-ask',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('tool_result').length).toBe(1);
    expect(messagesOf('token').map((message) => message.token).join('')).toBe('You have no devices.');
    expect(rounds).toBe(2);
  });

  it('previews a mutation before running it and records an audit entry', async () => {
    nextDraft = (_request, round) => {
      if (round === 0) {
        return {
          content: '',
          thinking: [],
          tools: [
            {
              id: 'call-1',
              name: 'alerts.create',
              label: 'Create an alert',
              status: 'pending',
              input: {
                name: 'CPU spike',
                displayName: 'office-nas',
                conditions: [{ metric: 'cpu', operator: '>', threshold: 80 }],
              },
              durationMs: 0,
            },
          ],
          usage: { inputTokens: 10, outputTokens: 2 },
          continuation: { steps: [{ type: 'function_call', id: 'call-1', name: 'alerts.create' }] },
        };
      }
      return plainDraft('Alert created.');
    };
    toolExecutor = async (name) => ({
      toolId: 'call-1',
      name: name as AssistantToolResult['name'],
      status: 'ok',
      summary: 'Alert created',
      data: { id: 'alert-1' },
    });

    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-preview',
        prompt: 'Create a CPU alert',
        mode: 'task',
        permissionLevel: 'always-ask',
      }),
    );
    await waitFor(() => messagesOf('tool_permission_request').length === 1);

    const requestedTool = messagesOf('tool_permission_request')[0]!.tool;
    expect(requestedTool.preview).toContain('CPU spike');
    expect(requestedTool.preview).toContain('office-nas');
    expect(requestedTool.preview).toContain('1 condition');

    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'tool_permission', requestId: 'req-preview', toolId: 'call-1', decision: 'allow_once' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      teamId: 'team-1',
      actorUuid: 'user-1',
      action: 'assistant.alerts.create',
    });
  });

  it('aborts the provider request when the client cancels mid-stream', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = adapter.generate;
    adapter.generate = async (request, handlers) => {
      lastSignal = request.signal;
      await gate;
      return original.call(adapter, request, handlers);
    };
    try {
      const ws = createSocket();
      assistantWebSocket.open!(ws);
      assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
      await waitFor(() => ws.data.userUuid !== null);
      assistantWebSocket.message!(
        ws,
        JSON.stringify({ type: 'stream', requestId: 'req-4', prompt: 'hi', mode: 'chat' }),
      );
      await waitFor(() => lastSignal !== undefined);

      assistantWebSocket.message!(ws, JSON.stringify({ type: 'cancel', requestId: 'req-4' }));
      await waitFor(() => lastSignal?.aborted === true);
      release?.();
      await Bun.sleep(20);

      expect(messagesOf('error')).toHaveLength(0);
      expect(messagesOf('done')).toHaveLength(0);
    } finally {
      adapter.generate = original;
      release?.();
    }
  });

  it('blocks unsafe prompts and sends a safety notice instead of tokens', async () => {
    const ws = createSocket();
    assistantWebSocket.open!(ws);
    assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
    await waitFor(() => ws.data.userUuid !== null);
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-5',
        prompt: 'I want to end it all',
        mode: 'chat',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('safety')[0]?.notice).toBe('crisis');
    expect(messagesOf('token')).toHaveLength(0);
    expect(messagesOf('error')).toHaveLength(0);
  });
});
