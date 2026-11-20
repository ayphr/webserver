import {
  ASSISTANT_VARIANTS,
  createDefaultAssistantState,
  type AssistantChat,
  type AssistantFolder,
  type AssistantMessage,
  type AssistantMessageFeedback,
  type AssistantState,
  type AssistantVariant,
} from '@common';
import { getAssistantState, saveAssistantState } from '../../lib/db';
import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import type { User } from '@common';

const MAX_CHATS = 500;
const MAX_FOLDERS = 200;
const MAX_MESSAGES_PER_CHAT = 2000;
const MAX_TITLE_LENGTH = 200;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 100_000;

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

  try {
    const state = parseAssistantState(body.state);
    const saved = await saveAssistantState(user.uuid, state);
    return json({ state: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid assistant state';
    return json({ error: message }, 400);
  }
});
