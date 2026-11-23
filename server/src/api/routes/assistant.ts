import {
  ASSISTANT_MODES,
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_THINKING_STATUSES,
  ASSISTANT_TOOL_PERMISSIONS,
  ASSISTANT_TOOL_STATUSES,
  ASSISTANT_VARIANTS,
  DEFAULT_ASSISTANT_PREFERENCES,
  createDefaultAssistantState,
  type AssistantChat,
  type AssistantFolder,
  type AssistantMessage,
  type AssistantMessageFeedback,
  type AssistantMode,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantPreferences,
  type AssistantState,
  type AssistantThinkingStep,
  type AssistantThinkingStatus,
  type AssistantToolCall,
  type AssistantToolInput,
  type AssistantToolPermission,
  type AssistantToolResult,
  type AssistantToolStatus,
  type AssistantUserQuestion,
  type AssistantVariant,
} from '@common';
import { deleteAssistantChat, getAssistantState, saveAssistantState } from '../../lib/db';
import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import type { User } from '@common';

const MAX_CHATS = 500;
const MAX_FOLDERS = 200;
const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_TITLE_LENGTH = 200;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_THINKING_STEPS = 12;
const MAX_TOOL_CALLS = 12;
const MAX_ALLOWED_TOOLS = 100;
const MAX_STEP_LABEL_LENGTH = 200;
const MAX_STEP_DETAIL_LENGTH = 1_000;
const MAX_TOOL_PAYLOAD_LENGTH = 20_000;
const MAX_QUESTION_STEPS = 5;

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

const requirePermissionLevel = (value: unknown, label: string): AssistantPermissionLevel => {
  if (
    typeof value !== 'string' ||
    !ASSISTANT_PERMISSION_LEVELS.includes(value as AssistantPermissionLevel)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantPermissionLevel;
};

const requireNotificationLevel = (value: unknown, label: string): AssistantNotificationLevel => {
  if (
    typeof value !== 'string' ||
    !ASSISTANT_NOTIFICATION_LEVELS.includes(value as AssistantNotificationLevel)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantNotificationLevel;
};

function parseToolPermission(value: unknown, label: string): AssistantToolPermission {
  if (
    typeof value !== 'string' ||
    !ASSISTANT_TOOL_PERMISSIONS.includes(value as AssistantToolPermission)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantToolPermission;
}

function parseThinkingStatus(value: unknown, label: string): AssistantThinkingStatus {
  if (typeof value !== 'string' || !ASSISTANT_THINKING_STATUSES.includes(value as AssistantThinkingStatus)) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantThinkingStatus;
}

function parseToolStatus(value: unknown, label: string): AssistantToolStatus {
  if (typeof value !== 'string' || !ASSISTANT_TOOL_STATUSES.includes(value as AssistantToolStatus)) {
    throw new Error(`invalid ${label}`);
  }
  return value as AssistantToolStatus;
}

function parseThinkingStep(value: unknown, label: string): AssistantThinkingStep {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  const step: AssistantThinkingStep = {
    id: requireId(value.id, `${label}.id`),
    label: requireString(value.label, `${label}.label`, MAX_STEP_LABEL_LENGTH),
    status: parseThinkingStatus(value.status, `${label}.status`),
  };
  if (value.detail !== undefined) {
    step.detail = requireString(value.detail, `${label}.detail`, MAX_STEP_DETAIL_LENGTH);
  }
  if (value.durationMs !== undefined) {
    step.durationMs = Math.max(0, requireNumber(value.durationMs, `${label}.durationMs`));
  }
  return step;
}

function requireJsonSize(value: unknown, label: string, maxLength: number): void {
  try {
    if (JSON.stringify(value).length > maxLength) throw new Error(`invalid ${label}`);
  } catch {
    throw new Error(`invalid ${label}`);
  }
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 100 || typeof item !== 'string' || item.length > 500) {
      throw new Error(`invalid ${label}`);
    }
    record[key] = item;
  }
  return record;
}

function parseUserQuestion(value: unknown, label: string): AssistantUserQuestion {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  if (!Array.isArray(value.steps) || value.steps.length > MAX_QUESTION_STEPS) {
    throw new Error(`invalid ${label}.steps`);
  }
  return {
    prompt: requireString(value.prompt, `${label}.prompt`, 500),
    customAnswerAllowed: value.customAnswerAllowed !== false,
    steps: value.steps.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`invalid ${label}.steps[${index}]`);
      if (!Array.isArray(raw.suggestedAnswers) || raw.suggestedAnswers.length < 2 || raw.suggestedAnswers.length > 6) {
        throw new Error(`invalid ${label}.steps[${index}].suggestedAnswers`);
      }
      return {
        id: requireId(raw.id, `${label}.steps[${index}].id`),
        prompt: requireString(raw.prompt, `${label}.steps[${index}].prompt`, 300),
        suggestedAnswers: raw.suggestedAnswers.map((answer, answerIndex) =>
          requireString(answer, `${label}.steps[${index}].suggestedAnswers[${answerIndex}]`, 120),
        ),
        ...(raw.recommendedAnswer === undefined
          ? {}
          : {
              recommendedAnswer: requireString(
                raw.recommendedAnswer,
                `${label}.steps[${index}].recommendedAnswer`,
                120,
              ),
            }),
      };
    }),
  };
}

function parseToolResult(value: unknown, label: string): AssistantToolResult {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  if (value.status !== 'ok' && value.status !== 'error') throw new Error(`invalid ${label}.status`);
  const result: AssistantToolResult = {
    toolId: requireId(value.toolId, `${label}.toolId`),
    name: requireString(value.name, `${label}.name`, MAX_STEP_LABEL_LENGTH),
    status: value.status,
    summary: requireString(value.summary, `${label}.summary`, MAX_STEP_DETAIL_LENGTH),
  };
  if (value.error !== undefined) {
    result.error = requireString(value.error, `${label}.error`, MAX_STEP_DETAIL_LENGTH);
  }
  if (value.data !== undefined) {
    requireJsonSize(value.data, `${label}.data`, MAX_TOOL_PAYLOAD_LENGTH);
    result.data = value.data;
  }
  if (value.question !== undefined) {
    result.question = parseUserQuestion(value.question, `${label}.question`);
  }
  if (value.answers !== undefined) {
    result.answers = parseStringRecord(value.answers, `${label}.answers`);
  }
  return result;
}

function parseToolCall(value: unknown, label: string): AssistantToolCall {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  const tool: AssistantToolCall = {
    id: requireId(value.id, `${label}.id`),
    name: requireString(value.name, `${label}.name`, MAX_STEP_LABEL_LENGTH),
    status: parseToolStatus(value.status, `${label}.status`),
  };
  if (value.label !== undefined) {
    tool.label = requireString(value.label, `${label}.label`, MAX_STEP_LABEL_LENGTH);
  }
  if (value.detail !== undefined) {
    tool.detail = requireString(value.detail, `${label}.detail`, MAX_STEP_DETAIL_LENGTH);
  }
  if (value.durationMs !== undefined) {
    tool.durationMs = Math.max(0, requireNumber(value.durationMs, `${label}.durationMs`));
  }
  if (value.error !== undefined) {
    tool.error = requireString(value.error, `${label}.error`, MAX_STEP_DETAIL_LENGTH);
  }
  if (value.permission !== undefined) {
    tool.permission = parseToolPermission(value.permission, `${label}.permission`);
  }
  if (value.input !== undefined) {
    if (!isRecord(value.input)) throw new Error(`invalid ${label}.input`);
    requireJsonSize(value.input, `${label}.input`, MAX_TOOL_PAYLOAD_LENGTH);
    tool.input = value.input as AssistantToolInput;
  }
  if (value.result !== undefined) {
    tool.result = parseToolResult(value.result, `${label}.result`);
  }
  return tool;
}

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

  if (value.creditCost !== undefined) {
    const creditCost = requireNumber(value.creditCost, `${label}.creditCost`);
    if (creditCost < 0) throw new Error(`invalid ${label}.creditCost`);
    message.creditCost = Math.min(creditCost, 1_000_000);
  }

  if (value.thinking !== undefined) {
    if (!Array.isArray(value.thinking) || value.thinking.length > MAX_THINKING_STEPS) {
      throw new Error(`invalid ${label}.thinking`);
    }
    message.thinking = value.thinking.map((step, index) =>
      parseThinkingStep(step, `${label}.thinking[${index}]`),
    );
  }

  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > MAX_TOOL_CALLS) {
      throw new Error(`invalid ${label}.tools`);
    }
    message.tools = value.tools.map((tool, index) =>
      parseToolCall(tool, `${label}.tools[${index}]`),
    );
  }

  return message;
}

function parseChat(value: unknown, label: string): AssistantChat {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  if (!Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES_PER_CHAT) {
    throw new Error(`invalid ${label}.messages`);
  }

  const chat: AssistantChat = {
    id: requireId(value.id, `${label}.id`),
    title: requireString(value.title, `${label}.title`, MAX_TITLE_LENGTH),
    folderId: requireNullableId(value.folderId, `${label}.folderId`),
    mode: value.mode === undefined ? 'chat' : requireMode(value.mode, `${label}.mode`),
    messages: value.messages.map((message, index) =>
      parseMessage(message, `${label}.messages[${index}]`),
    ),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
    updatedAt: requireNumber(value.updatedAt, `${label}.updatedAt`),
  };
  if (value.order !== undefined) chat.order = requireNumber(value.order, `${label}.order`);
  if (value.contextSummary !== undefined) {
    chat.contextSummary = requireString(value.contextSummary, `${label}.contextSummary`, 20_000);
  }
  if (value.compactedThroughMessageId !== undefined) {
    chat.compactedThroughMessageId = requireNumber(
      value.compactedThroughMessageId,
      `${label}.compactedThroughMessageId`,
    );
  }
  return chat;
}

function parseFolder(value: unknown, label: string): AssistantFolder {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  const folder: AssistantFolder = {
    id: requireId(value.id, `${label}.id`),
    name: requireString(value.name, `${label}.name`, MAX_FOLDER_NAME_LENGTH),
    createdAt: requireNumber(value.createdAt, `${label}.createdAt`),
  };
  if (value.order !== undefined) folder.order = requireNumber(value.order, `${label}.order`);
  return folder;
}

function parseAssistantPreferences(value: unknown): AssistantPreferences {
  if (!isRecord(value)) throw new Error('invalid preferences');

  const allowedToolsValue = value.allowedTools ?? DEFAULT_ASSISTANT_PREFERENCES.allowedTools;
  if (!Array.isArray(allowedToolsValue) || allowedToolsValue.length > MAX_ALLOWED_TOOLS) {
    throw new Error('invalid allowedTools');
  }
  const allowedTools = allowedToolsValue.map((tool, index) =>
    requireId(tool, `allowedTools[${index}]`),
  );
  if (new Set(allowedTools).size !== allowedTools.length) {
    throw new Error('duplicate allowed tool');
  }

  const sendShortcut = value.sendShortcut ?? DEFAULT_ASSISTANT_PREFERENCES.sendShortcut;
  if (sendShortcut !== 'enter' && sendShortcut !== 'shift-enter') {
    throw new Error('invalid sendShortcut');
  }

  return {
    defaultVariant: requireVariant(value.defaultVariant, 'defaultVariant'),
    sendShortcut,
    permissionLevel:
      value.permissionLevel === undefined
        ? DEFAULT_ASSISTANT_PREFERENCES.permissionLevel
        : requirePermissionLevel(value.permissionLevel, 'permissionLevel'),
    notificationLevel:
      value.notificationLevel === undefined
        ? DEFAULT_ASSISTANT_PREFERENCES.notificationLevel
        : requireNotificationLevel(value.notificationLevel, 'notificationLevel'),
    allowedTools,
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

  return {
    chats,
    folders,
    activeChatId,
    activeFolderId,
    activeMode,
    preferences: parseAssistantPreferences(value.preferences),
  };
}

export const handleGetState = requireAuth(async (_request, user: User) => {
  const state = await getAssistantState(user.uuid);
  return json({ state: state ?? createDefaultAssistantState() });
});

export const handleSaveState = requireAuth(async (request, user: User) => {
  const body = await readJsonBody<unknown>(request);
  if (!isRecord(body)) return json({ error: 'request body must be valid JSON' }, 400);

  try {
    const state = parseAssistantState(body.state);
    const saved = await saveAssistantState(user.uuid, state);
    return json({ state: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid assistant state';
    return json({ error: message }, 400);
  }
});

const handleDeleteChat = requireAuth(async (_request, user: User, params) => {
  const chatId = typeof params.id === 'string' ? params.id : '';
  if (!chatId) return json({ error: 'invalid id' }, 400);

  const state = await deleteAssistantChat(user.uuid, chatId);
  return json({ state });
});

export { handleDeleteChat as handleAssistantDeleteChat };
