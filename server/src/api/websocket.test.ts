import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AssistantModelDraft, AssistantModelRequest, AssistantModelStreamHandlers } from '../lib/assistantModel';
import type { AssistantState, AssistantToolResult } from '@common';

type Sent = Record<string, any>;

const sent: Sent[] = [];
const savedResults: Record<string, any>[] = [];
const holds: number[] = [];
const settlements: Record<string, any>[] = [];
const notifications: Record<string, any>[] = [];
const auditEntries: Record<string, any>[] = [];
let nextDraft: (request: AssistantModelRequest, round: number) => AssistantModelDraft;
let toolExecutor: (
  name: string,
  input: Record<string, unknown>,
  toolId: string,
) => Promise<AssistantToolResult>;
let rounds = 0;
let lastSignal: AbortSignal | undefined;
let deltaSpy: ((chunks: string[]) => void) | undefined;
let deltaChunks: string[] | undefined;
let assistantState: AssistantState | null = null;
let availableCredits = 100;
let stateShouldThrow = false;

const splitForTest = (content: string): string[] => {
  if (!content) return [];
  const mid = Math.max(1, Math.floor(content.length / 2));
  return [content.slice(0, mid), content.slice(mid)];
};

const adapter = {
  id: 'test-gemini',
  generate: async (
    request: AssistantModelRequest,
    handlers?: AssistantModelStreamHandlers,
  ): Promise<AssistantModelDraft> => {
    lastSignal = request.signal;
    const round = rounds++;
    const draft = nextDraft(request, round);
    const chunks = deltaChunks ?? splitForTest(draft.content);
    if (handlers?.onTextDelta) {
      for (const chunk of chunks) handlers.onTextDelta(chunk);
    }
    deltaSpy?.(chunks);
    return draft;
  },
};

mock.module('./auth', () => ({
  getUserFromToken: async () => ({ uuid: 'user-1', teamId: 'team-1' }),
}));
mock.module('../lib/assistantModel', () => ({
  getAssistantModelAdapter: () => adapter,
}));
mock.module('../lib/assistantTools', () => ({
  executeAssistantTool: (
    name: string,
    options: { input: Record<string, unknown>; toolId: string },
  ) => toolExecutor(name, options.input, options.toolId),
}));
mock.module('../lib/db/assistant', () => ({
  getAssistantState: async () => {
    if (stateShouldThrow) throw new Error('database unavailable');
    return assistantState;
  },
  saveStreamResult: async (_userUuid: string, record: Record<string, any>) => {
    savedResults.push(record);
  },
  updateAssistantChatContext: async () => {},
}));
mock.module('../lib/credits', () => ({
  getCreditBalanceFromUuid: async () => ({ available: availableCredits, total: 100, onHold: 0 }),
  holdCredits: async (_userUuid: string, amount: number) => {
    holds.push(amount);
    return { changed: true };
  },
  settleCreditHold: async (
    _userUuid: string,
    held: number,
    cost: number,
    options: Record<string, any>,
  ) => {
    settlements.push({ held, cost, options });
    return cost;
  },
}));
mock.module('../lib/notifications', () => ({
  notifyUser: async (entry: Record<string, any>) => {
    notifications.push(entry);
  },
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

const authedSocket = async () => {
  const ws = createSocket();
  assistantWebSocket.open!(ws);
  assistantWebSocket.message!(ws, JSON.stringify({ type: 'auth', token: 'token' }));
  await waitFor(() => ws.data.userUuid !== null);
  return ws;
};

const plainDraft = (content: string): AssistantModelDraft => ({
  content,
  thinking: [],
  tools: [],
  usage: { inputTokens: 10, outputTokens: 5 },
});

const toolDraft = (id: string, name = 'devices.list'): AssistantModelDraft => ({
  content: '',
  thinking: [],
  tools: [
    {
      id,
      name,
      label: name,
      status: 'pending',
      input: {},
      durationMs: 0,
    },
  ],
  usage: { inputTokens: 10, outputTokens: 2 },
  continuation: { steps: [{ type: 'function_call', id, name }] },
});

const preferencesState = (
  permissionLevel: 'always-ask' | 'sometimes-ask' | 'never-ask',
  notificationLevel: 'always' | 'sometimes' | 'never' = 'always',
): AssistantState => ({
  chats: [],
  folders: [],
  activeChatId: null,
  activeFolderId: null,
  activeMode: 'task',
  preferences: {
    defaultVariant: 'standard',
    sendShortcut: 'enter',
    permissionLevel,
    notificationLevel,
    allowedTools: [],
  },
});

describe('assistant websocket streaming', () => {
  beforeEach(() => {
    sent.length = 0;
    savedResults.length = 0;
    holds.length = 0;
    settlements.length = 0;
    notifications.length = 0;
    auditEntries.length = 0;
    rounds = 0;
    lastSignal = undefined;
    deltaSpy = undefined;
    deltaChunks = undefined;
    assistantState = null;
    availableCredits = 100;
    stateShouldThrow = false;
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
    const ws = await authedSocket();

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
    expect(tokens.map((message) => message.index)).toEqual([0, 1, 2, 3, 4]);
    expect(messagesOf('error')).toHaveLength(0);
    const done = messagesOf('done')[0]!;
    expect(done.durationMs).toBeGreaterThan(0);
    expect(done.creditCost).toBeGreaterThan(0);
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.held).toBe(holds[0]);
  });

  it('keeps a whitespace-only live chunk so words cannot join', async () => {
    const first = `a`.repeat(60);
    const second = `b`.repeat(40);
    const content = `${first} ${second}`;
    nextDraft = () => plainDraft(content);
    // The trailing-space delta sits at the live-flush boundary so the space is
    // emitted as its own token instead of being merged into the next word.
    deltaChunks = [`${'a'.repeat(48)}`, `${'a'.repeat(12)} ${second}`];
    const ws = await authedSocket();

    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-boundary', prompt: 'hi', mode: 'chat' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    const tokens = messagesOf('token');
    expect(tokens.some((message) => message.token === ' ')).toBe(true);
    expect(tokens.map((message) => message.token).join('')).toBe(content);
  });

  it('keeps a newline-only live chunk', async () => {
    const first = `a`.repeat(60);
    const second = `b`.repeat(40);
    nextDraft = () => plainDraft(`${first}\n${second}`);
    deltaChunks = [`${'a'.repeat(48)}\n`, `${'a'.repeat(12)}${second}`];
    const ws = await authedSocket();

    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-newline', prompt: 'hi', mode: 'chat' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('token').some((message) => message.token === '\n')).toBe(true);
  });

  it('continues after a tool round and appends the second draft', async () => {
    nextDraft = (request, round) => {
      if (round === 0) return toolDraft('call-1');
      expect(request.toolResults?.[0]?.name).toBe('devices.list');
      return plainDraft('You have no devices.');
    };

    const ws = await authedSocket();
    assistantState = preferencesState('never-ask');
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-3',
        prompt: 'What devices do I have?',
        mode: 'task',
        // The client must not be able to weaken server preferences.
        permissionLevel: 'always-ask',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('tool_permission_request')).toHaveLength(0);
    expect(messagesOf('tool_result')).toHaveLength(1);
    expect(messagesOf('token').map((message) => message.token).join('')).toBe('You have no devices.');
    expect(rounds).toBe(2);
  });

  it('does not reuse permission decisions or results when provider IDs repeat', async () => {
    let executions = 0;
    nextDraft = (_request, round) => {
      if (round >= 2) return plainDraft('Done.');
      return toolDraft(`call-${round}`);
    };
    toolExecutor = async (_name, _input, toolId) => {
      executions += 1;
      return {
        toolId,
        name: 'devices.list',
        status: 'ok',
        summary: `execution ${executions}`,
        data: { devices: [] },
      };
    };
    assistantState = preferencesState('never-ask');
    const ws = await authedSocket();

    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-rounds', prompt: 'check twice', mode: 'task' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('tool_result').map((message) => message.result.summary)).toEqual([
      'execution 1',
      'execution 2',
    ]);
    expect(rounds).toBe(3);
  });

  it('uses server permission preferences even when the client asks for never-ask', async () => {
    nextDraft = (_request, round) =>
      round === 0 ? toolDraft('call-perm', 'alerts.create') : plainDraft('Done.');
    assistantState = preferencesState('always-ask');
    const ws = await authedSocket();

    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-perm-pref',
        prompt: 'create an alert',
        mode: 'task',
        permissionLevel: 'never-ask',
        allowedTools: ['alerts.create'],
      }),
    );
    await waitFor(() => messagesOf('tool_permission_request').length === 1);

    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'tool_permission',
        requestId: 'req-perm-pref',
        toolId: 'call-perm',
        decision: 'allow_once',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);
  });

  it('audits mutations at execution with normalized input', async () => {
    nextDraft = (_request, round) => {
      if (round === 0) {
        return {
          ...toolDraft('call-audit', 'alerts.create'),
          tools: [
            {
              id: 'call-audit',
              name: 'alerts.create',
              label: 'Create alert',
              status: 'pending',
              input: {
                name: 'CPU spike',
                displayName: 'office-nas',
                conditions: [{ metric: 'temperature', operator: 'gt', value: 80 }],
                unexpected: 'client supplied',
              },
              durationMs: 0,
            },
          ],
        };
      }
      return plainDraft('Alert created.');
    };
    toolExecutor = async (name, _input, toolId) => ({
      toolId,
      name: name as AssistantToolResult['name'],
      status: 'ok',
      summary: 'Alert created',
      data: { id: 'alert-1' },
    });
    assistantState = preferencesState('never-ask');
    const ws = await authedSocket();

    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-audit', prompt: 'create alert', mode: 'task' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]!.details.input).toMatchObject({
      name: 'alerts.create',
      displayName: 'CPU spike',
      conditions: [{ metric: 'temperature', operator: 'gt', value: 80 }],
    });
    expect(auditEntries[0]!.details.input.unexpected).toBeUndefined();
  });

  it('scopes tool approvals to the socket that requested them', async () => {
    nextDraft = (_request, round) => {
      if (round === 0) return toolDraft('call-a', 'alerts.create');
      if (round === 1) return toolDraft('call-b', 'alerts.create');
      return plainDraft('Done.');
    };
    toolExecutor = async (_name, _input, toolId) => ({
      toolId,
      name: 'alerts.create',
      status: 'ok',
      summary: `approved ${toolId}`,
      data: {},
    });
    assistantState = preferencesState('always-ask');
    const first = await authedSocket();
    const second = await authedSocket();

    for (const [index, ws] of [first, second].entries()) {
      assistantWebSocket.message!(
        ws,
        JSON.stringify({
          type: 'stream',
          requestId: 'shared-request-id',
          prompt: `task ${index}`,
          mode: 'task',
        }),
      );
    }
    await waitFor(() => messagesOf('tool_permission_request').length === 2);

    assistantWebSocket.message!(
      second,
      JSON.stringify({
        type: 'tool_permission',
        requestId: 'shared-request-id',
        toolId: 'call-b',
        decision: 'allow_once',
      }),
    );
    await waitFor(() => messagesOf('tool_result').some((message) => message.toolId === 'call-b'));

    expect(messagesOf('tool_result').some((message) => message.toolId === 'call-a')).toBe(false);

    assistantWebSocket.message!(
      first,
      JSON.stringify({
        type: 'tool_permission',
        requestId: 'shared-request-id',
        toolId: 'call-a',
        decision: 'allow_once',
      }),
    );
    await waitFor(() => messagesOf('done').length === 2);
  });

  it('answers unsafe prompts locally without a provider call or credit charge', async () => {
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-5',
        prompt: 'I want to end it all',
        mode: 'chat',
        chatId: 'chat-1',
        messageId: 2,
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('safety')[0]?.notice).toBe('crisis');
    expect(rounds).toBe(0);
    expect(holds).toHaveLength(0);
    expect(settlements).toHaveLength(0);
    expect(messagesOf('done')[0]!.creditCost).toBe(0);
    expect(messagesOf('token').map((message) => message.token).join('')).toContain('988');
    const persisted = savedResults.find((result) => result.assistantMessage);
    expect(persisted!.assistantMessage.safetyNotice).toBe('crisis');
    expect(persisted!.assistantMessage.content).toContain('988');
    expect(persisted!.assistantMessage.creditCost).toBe(0);
  });

  it('classifies suicidal intent with violence as a crisis, not a refusal', async () => {
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-crisis',
        prompt: 'I want to kill myself and my family',
        mode: 'chat',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);
    expect(messagesOf('safety')[0]?.notice).toBe('crisis');
    expect(rounds).toBe(0);
  });

  it('keeps explicit child exploitation as the top safety notice', async () => {
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-csam',
        prompt: 'I am suicidal and I want csam',
        mode: 'chat',
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);
    expect(messagesOf('safety')[0]?.notice).toBe('csam');
  });

  it('rolls back emitted text when final-pass safety fires', async () => {
    nextDraft = () => plainDraft(`${'Safe answer. '.repeat(20)}I want to kill myself`);
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({
        type: 'stream',
        requestId: 'req-output-safety',
        prompt: 'Explain the weather',
        mode: 'chat',
        chatId: 'chat-2',
        messageId: 2,
      }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('safety')[0]?.notice).toBe('crisis');
    const persisted = savedResults.find((result) => result.assistantMessage);
    expect(persisted!.assistantMessage.content).not.toContain('kill myself');
  });

  it('does not mark unexecuted tools as done on completion', async () => {
    nextDraft = () => ({
      ...plainDraft(`${'Safe. '.repeat(20)}I want to kill myself`),
      tools: [
        { id: 'never-ran', name: 'devices.list', label: 'Devices', status: 'pending', input: {}, durationMs: 0 },
      ],
    });
    assistantState = preferencesState('never-ask');
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-unexecuted', prompt: 'hello', mode: 'task' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    expect(messagesOf('tool_result')).toHaveLength(0);
    expect(messagesOf('tool').filter((message) => message.tool.status === 'done')).toHaveLength(0);
  });

  it('scrubs internal identifiers and cost arithmetic from model output', async () => {
    nextDraft = () => plainDraft(
      'I used devices.list through /v1beta/interactions with gemini-4-carbon. ' +
      'The onHold value was 12 and 1 credit = $0.005 USD. Request req-secret-123 was logged in assistantStates.',
    );
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-secret-123', prompt: 'how do you work?', mode: 'chat' }),
    );
    await waitFor(() => messagesOf('done').length === 1);

    const displayed = messagesOf('token').map((message) => message.token).join('');
    expect(displayed).not.toContain('devices.list');
    expect(displayed).not.toContain('/v1beta/interactions');
    expect(displayed).not.toContain('gemini-4-carbon');
    expect(displayed).not.toContain('0.005');
    expect(displayed).not.toContain('req-secret-123');
    expect(displayed).not.toContain('assistantStates');
  });

  it('redacts PII and internal IDs before replaying tool results', async () => {
    nextDraft = (request, round) => {
      if (round === 0) return toolDraft('call-data');
      const replay = request.toolResults?.[0]?.content ?? '';
      expect(replay).toContain('[email redacted]');
      expect(replay).toContain('team_secret_abc123');
      expect(replay).not.toContain('alice@example.com');
      expect(replay).toContain('"email"');
      return plainDraft('Here is what I found.');
    };
    toolExecutor = async (_name, _input, toolId) => ({
      toolId,
      name: 'devices.list',
      status: 'ok',
      summary: 'Found a device',
      data: { email: 'alice@example.com', note: 'team_secret_abc123', serial: 123456789 },
    });
    assistantState = preferencesState('never-ask');
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-redact', prompt: 'check devices', mode: 'task' }),
    );
    await waitFor(() => messagesOf('done').length === 1);
    expect(rounds).toBe(2);
  });

  it('settles exactly once after repeated cancellation', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = adapter.generate;
    adapter.generate = async (request, handlers) => {
      lastSignal = request.signal;
      await gate;
      rounds += 1;
      return original.call(adapter, request, handlers);
    };
    try {
      const ws = await authedSocket();
      assistantWebSocket.message!(
        ws,
        JSON.stringify({ type: 'stream', requestId: 'req-4', prompt: 'hi', mode: 'chat' }),
      );
      await waitFor(() => lastSignal !== undefined);

      const cancel = JSON.stringify({ type: 'cancel', requestId: 'req-4' });
      assistantWebSocket.message!(ws, cancel);
      assistantWebSocket.message!(ws, cancel);
      await waitFor(() => settlements.length === 1);
      release?.();
      await Bun.sleep(20);

      expect(settlements).toHaveLength(1);
      expect(messagesOf('error')).toHaveLength(0);
      expect(messagesOf('done')).toHaveLength(0);
    } finally {
      adapter.generate = original;
      release?.();
    }
  });

  it('fails and settles an unanswered interactive stream after the overall timeout', async () => {
    const originalTimeout = process.env.ASSISTANT_STREAM_TIMEOUT_MS;
    process.env.ASSISTANT_STREAM_TIMEOUT_MS = '40';
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
      const ws = await authedSocket();
      assistantWebSocket.message!(
        ws,
        JSON.stringify({ type: 'stream', requestId: 'req-timeout', prompt: 'hi', mode: 'chat' }),
      );
      await waitFor(() => messagesOf('error').length === 1);
      expect(messagesOf('error')[0]!.error).toContain('too long');
      expect(settlements).toHaveLength(1);
      expect(lastSignal?.aborted).toBe(true);
    } finally {
      adapter.generate = original;
      release?.();
      if (originalTimeout === undefined) delete process.env.ASSISTANT_STREAM_TIMEOUT_MS;
      else process.env.ASSISTANT_STREAM_TIMEOUT_MS = originalTimeout;
    }
  });

  it('reports unexpected preflight failures and settles nothing', async () => {
    stateShouldThrow = true;
    const ws = await authedSocket();
    assistantWebSocket.message!(
      ws,
      JSON.stringify({ type: 'stream', requestId: 'req-preflight', prompt: 'hi', mode: 'task' }),
    );
    await waitFor(() => messagesOf('error').length === 1);

    expect(messagesOf('error')[0]!.error).toBe('Assistant request failed');
    expect(notifications.some((notice) => notice.message.includes('error'))).toBe(true);
    expect(settlements).toHaveLength(0);
  });
});
