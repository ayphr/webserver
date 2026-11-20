import {
  ASSISTANT_MODES,
  ASSISTANT_VARIANTS,
  createDefaultAssistantState,
  type AssistantChat,
  type AssistantFolder,
  type AssistantMessage,
  type AssistantMessageFeedback,
  type AssistantMode,
  type AssistantState,
  type AssistantVariant,
} from '@common';
import {
  getAssistantMetrics,
  getAssistantState,
  normalizeAssistantMetricsPeriodDays,
  recordAssistantStateMetrics,
  saveAssistantState,
} from '../../lib/db';
import { json, readJsonBody } from '../../lib/http';
import { createLogger } from '../../lib/logger';
import { assistantRateLimitedTotal } from '../../lib/metrics';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { getClientIp } from '../../lib/requestContext';
import { requireAuth, requireRole } from '../auth';
import type { User } from '@common';

const MAX_CHATS = 500;
const MAX_FOLDERS = 200;
const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_TITLE_LENGTH = 200;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 100_000;

const metricsLimiter = createRateLimiter(60 * 1000, 30, 'assistant-metrics');
const staffMetricsLimiter = createRateLimiter(60 * 1000, 60, 'staff-assistant-metrics');
const metricsLog = createLogger('assistant-metrics');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`invalid ${label}`);
  }
  return value;
};

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
};

const requireId = (value: unknown, label: string): string => {
  const id = requireString(value, label, 200);
  if (!id) throw new Error(`invalid ${label}`);
  return id;
};

const requireNullableId = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  return requireId(value, label);
};

const requireVariant = (value: unknown, label: string): AssistantVariant => {
  if (typeof value !== 'string' || !ASSISTANT_VARIANTS.includes(value as AssistantVariant)) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantVariant;
};

const requireMode = (value: unknown, label: string): AssistantMode => {
  if (typeof value !== 'string' || !ASSISTANT_MODES.includes(value as AssistantMode)) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantMode;
};

function parseMessage(value: unknown, label: string): AssistantMessage {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);

  const id = requireNumber(value.id, `${label}.id`);
  if (!Number.isInteger(id)) throw new Error(`invalid ${label}.id`);

  const role = value.role;
  if (role !== 'user' && role !== 'assistant') throw new Error(`invalid ${label}.role`);

  const message: AssistantMessage = {
    id,
    role,
    content: requireString(value.content, `${label}.content`, MAX_MESSAGE_LENGTH),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
  };

  if (value.interrupted !== undefined) {
    if (typeof value.interrupted !== 'boolean') throw new Error(`invalid ${label}.interrupted`);
    message.interrupted = value.interrupted;
  }

  if (value.error !== undefined) {
    message.error = requireString(value.error, `${label}.error`, MAX_MESSAGE_LENGTH);
  }

  if (value.feedback !== undefined) {
    if (
      value.feedback === null ||
      value.feedback === 'like' ||
      value.feedback === 'dislike'
    ) {
      message.feedback = value.feedback as AssistantMessageFeedback;
    } else {
      throw new Error(`invalid ${label}.feedback`);
    }
  }

  if (value.variant !== undefined) {
    message.variant = requireVariant(value.variant, `${label}.variant`);
  }

  if (value.durationMs !== undefined) {
    const durationMs = requireNumber(value.durationMs, `${label}.durationMs`);
    message.durationMs = Math.max(0, durationMs);
  }

  if (value.thinking !== undefined) {
    if (!Array.isArray(value.thinking) || value.thinking.length > 100) {
      throw new Error(`invalid ${label}.thinking`);
    }
    message.thinking = value.thinking.map((step, index) => {
      if (!isRecord(step)) throw new Error(`invalid ${label}.thinking[${index}]`);
      const status = step.status;
      if (status !== 'pending' && status !== 'running' && status !== 'done') {
        throw new Error(`invalid ${label}.thinking[${index}].status`);
      }
      const parsed: {
        id: string;
        title: string;
        status: typeof status;
        detail?: string;
      } = {
        id: requireId(step.id, `${label}.thinking[${index}].id`),
        title: requireString(step.title, `${label}.thinking[${index}].title`, MAX_MESSAGE_LENGTH),
        status,
      };
      if (step.detail !== undefined) {
        parsed.detail = requireString(
          step.detail,
          `${label}.thinking[${index}].detail`,
          MAX_MESSAGE_LENGTH,
        );
      }
      return parsed;
    });
  }

  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > 100) {
      throw new Error(`invalid ${label}.tools`);
    }
    message.tools = value.tools.map((tool, index) => {
      if (!isRecord(tool)) throw new Error(`invalid ${label}.tools[${index}]`);
      const status = tool.status;
      if (
        status !== 'pending' &&
        status !== 'running' &&
        status !== 'done' &&
        status !== 'error'
      ) {
        throw new Error(`invalid ${label}.tools[${index}].status`);
      }
      const parsed: {
        id: string;
        name: string;
        status: typeof status;
        detail?: string;
        durationMs?: number;
      } = {
        id: requireId(tool.id, `${label}.tools[${index}].id`),
        name: requireString(tool.name, `${label}.tools[${index}].name`, MAX_TITLE_LENGTH),
        status,
      };
      if (tool.detail !== undefined) {
        parsed.detail = requireString(
          tool.detail,
          `${label}.tools[${index}].detail`,
          MAX_MESSAGE_LENGTH,
        );
      }
      if (tool.durationMs !== undefined) {
        parsed.durationMs = Math.max(0, requireNumber(tool.durationMs, `${label}.tools[${index}].durationMs`));
      }
      return parsed;
    });
  }

  return message;
}

function parseChat(value: unknown, label: string): AssistantChat {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  if (!Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES_PER_CHAT) {
    throw new Error(`invalid ${label}.messages`);
  }

  return {
    id: requireId(value.id, `${label}.id`),
    title: requireString(value.title, `${label}.title`, MAX_TITLE_LENGTH),
    folderId: requireNullableId(value.folderId, `${label}.folderId`),
    pinned:
      value.pinned === undefined
        ? false
        : (() => {
            if (typeof value.pinned !== 'boolean') throw new Error(`invalid ${label}.pinned`);
            return value.pinned;
          })(),
    order: value.order === undefined ? 0 : requireNumber(value.order, `${label}.order`),
    mode: value.mode === undefined ? 'chat' : requireMode(value.mode, `${label}.mode`),
    messages: value.messages.map((message, index) =>
      parseMessage(message, `${label}.messages[${index}]`),
    ),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
    updatedAt: requireNumber(value.updatedAt, `${label}.updatedAt`),
  };
}

function parseFolder(value: unknown, label: string): AssistantFolder {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  return {
    id: requireId(value.id, `${label}.id`),
    name: requireString(value.name, `${label}.name`, MAX_FOLDER_NAME_LENGTH),
    order: value.order === undefined ? 0 : requireNumber(value.order, `${label}.order`),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
  };
}

function parseAssistantState(value: unknown): AssistantState {
  if (!isRecord(value)) throw new Error('invalid state');
  if (!Array.isArray(value.chats) || value.chats.length > MAX_CHATS) {
    throw new Error('invalid chats');
  }
  if (!Array.isArray(value.folders) || value.folders.length > MAX_FOLDERS) {
    throw new Error('invalid folders');
  }
  if (!isRecord(value.preferences)) throw new Error('invalid preferences');

  const folders = value.folders.map((folder, index) => parseFolder(folder, `folders[${index}]`));
  const folderIds = new Set(folders.map((folder) => folder.id));
  if (folderIds.size !== folders.length) throw new Error('duplicate folder id');

  const chats = value.chats.map((chat, index) => parseChat(chat, `chats[${index}]`));
  const chatIds = new Set(chats.map((chat) => chat.id));
  if (chatIds.size !== chats.length) throw new Error('duplicate chat id');

  for (const chat of chats) {
    if (chat.folderId !== null && !folderIds.has(chat.folderId)) {
      throw new Error('chat references unknown folder');
    }
  }

  const activeChatId = requireNullableId(value.activeChatId, 'activeChatId');
  const activeFolderId = requireNullableId(value.activeFolderId, 'activeFolderId');
  const activeMode = value.activeMode === undefined ? 'chat' : requireMode(value.activeMode, 'activeMode');
  if (activeChatId !== null && !chatIds.has(activeChatId)) {
    throw new Error('active chat does not exist');
  }
  if (activeFolderId !== null && !folderIds.has(activeFolderId)) {
    throw new Error('active folder does not exist');
  }

  const defaultVariant = requireVariant(value.preferences.defaultVariant, 'defaultVariant');
  const sendShortcut = value.preferences.sendShortcut;
  if (sendShortcut !== 'enter' && sendShortcut !== 'shift-enter') {
    throw new Error('invalid sendShortcut');
  }

  return {
    chats,
    folders,
    activeChatId,
    activeFolderId,
    activeMode,
    preferences: { defaultVariant, sendShortcut },
  };
}

export const handleGetState = requireAuth(async (_request, user: User) => {
  const state = await getAssistantState(user.uuid);
  return json({ state: state ?? createDefaultAssistantState() });
});

export const handleSaveState = requireAuth(async (request, user: User) => {
  const body = await readJsonBody<unknown>(request);
  if (!isRecord(body)) return json({ error: 'request body must be valid JSON' }, 400);

  let state: AssistantState;
  try {
    state = parseAssistantState(body.state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid assistant state';
    return json({ error: message }, 400);
  }

  const saved = await saveAssistantState(user.uuid, state);
  try {
    // One count-only snapshot per user per hour; failures never break saves.
    await recordAssistantStateMetrics(user.uuid, state);
  } catch (error) {
    metricsLog.warn({ error, userUuid: user.uuid }, 'failed to record assistant metrics snapshot');
  }
  return json({ state: saved });
});

export const handleGetMetrics = requireAuth(async (request, user: User) => {
  const rate = await metricsLimiter.check(`user:${user.uuid}`);
  if (!rate.allowed) {
    assistantRateLimitedTotal.inc({ limiter: 'assistant-metrics' });
    return tooManyRequests(rate.retryAfterMs);
  }

  const params = new URL(request.url).searchParams;
  const periodDays = normalizeAssistantMetricsPeriodDays(params.get('days'));
  return json(await getAssistantMetrics(user.uuid, periodDays));
});

export const handleGetStaffAssistantMetrics = requireRole('staff', async (request, staffUser: User) => {
  const rate = await staffMetricsLimiter.check(`staff:${staffUser.uuid}:ip:${getClientIp(request)}`);
  if (!rate.allowed) {
    assistantRateLimitedTotal.inc({ limiter: 'staff-assistant-metrics' });
    return tooManyRequests(rate.retryAfterMs);
  }

  const params = new URL(request.url).searchParams;
  const requestedUuid = params.get('userUuid');
  const userUuid = requestedUuid && requestedUuid.length <= 200 ? requestedUuid : null;
  const periodDays = normalizeAssistantMetricsPeriodDays(params.get('days'));
  return json(await getAssistantMetrics(userUuid, periodDays));
});
