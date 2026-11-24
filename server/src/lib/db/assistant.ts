import {
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_VARIANTS,
  DEFAULT_ASSISTANT_PREFERENCES,
  createDefaultAssistantState,
  type AssistantChat,
  type AssistantMessage,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantPreferences,
  type AssistantState,
  type AssistantVariant,
} from '@common';
import {
  ASSISTANT_STATES_COLLECTION,
  getCollection,
  trackMongoOperation,
  type AssistantStateDocument,
  type StreamResultRecord,
} from './internal';

const normalizePreferences = (
  value: AssistantPreferences | undefined,
): AssistantPreferences => {
  const defaultVariant =
    value?.defaultVariant && ASSISTANT_VARIANTS.includes(value.defaultVariant)
      ? value.defaultVariant
      : DEFAULT_ASSISTANT_PREFERENCES.defaultVariant;
  const permissionLevel =
    value?.permissionLevel && ASSISTANT_PERMISSION_LEVELS.includes(value.permissionLevel)
      ? value.permissionLevel
      : DEFAULT_ASSISTANT_PREFERENCES.permissionLevel;
  const notificationLevel =
    value?.notificationLevel && ASSISTANT_NOTIFICATION_LEVELS.includes(value.notificationLevel)
      ? value.notificationLevel
      : DEFAULT_ASSISTANT_PREFERENCES.notificationLevel;

  return {
    defaultVariant: defaultVariant as AssistantVariant,
    sendShortcut: value?.sendShortcut ?? DEFAULT_ASSISTANT_PREFERENCES.sendShortcut,
    permissionLevel: permissionLevel as AssistantPermissionLevel,
    notificationLevel: notificationLevel as AssistantNotificationLevel,
    allowedTools: Array.isArray(value?.allowedTools)
      ? value.allowedTools.filter((tool): tool is string => typeof tool === 'string')
      : [],
  };
};

/** Mongo field names cannot contain `.` or `$`. */
const streamResultKey = (chatId: string, messageId: number) =>
  `${chatId.replace(/[.$]/g, '_')}:${messageId}`;

/**
 * Fold server-authored stream results into the chats returned to a client.
 * Results win over stale placeholder/error messages with the same id, while
 * client-owned fields such as feedback are kept.
 */
export const mergeStreamResults = (
  state: AssistantState,
  records: Record<string, StreamResultRecord> | undefined,
): AssistantState => {
  const values = Object.values(records ?? {});
  if (values.length === 0) return state;

  const chats = [...state.chats];
  for (const record of values) {
    const existingChatIndex = chats.findIndex((chat) => chat.id === record.chatId);
    const existingChat = existingChatIndex >= 0 ? chats[existingChatIndex]! : undefined;
    const messages = [...(existingChat?.messages ?? [])];

    const upsert = (message: AssistantMessage) => {
      const index = messages.findIndex(
        (item) => item.id === message.id && item.role === message.role,
      );
      if (index < 0) {
        messages.push(message);
        return;
      }
      const existing = messages[index]!;
      messages[index] = {
        ...message,
        feedback: existing.feedback ?? message.feedback ?? null,
      };
    };

    const hasMessage = (message: AssistantMessage) =>
      messages.some((item) => item.id === message.id && item.role === message.role);
    // A newer client chat means the user explicitly changed these messages
    // (for example with Undo). Do not resurrect them from the result store.
    const respectRemovals = Boolean(existingChat && existingChat.updatedAt > record.updatedAt);

    if (record.userMessage && (!respectRemovals || hasMessage(record.userMessage))) {
      upsert(record.userMessage);
    }
    if (record.assistantMessage && (!respectRemovals || hasMessage(record.assistantMessage))) {
      upsert(record.assistantMessage);
    }
    messages.sort((a, b) => a.id - b.id);

    const chat: AssistantChat = {
      id: record.chatId,
      title: existingChat?.title ?? record.chatTitle,
      folderId: existingChat?.folderId ?? null,
      mode: existingChat?.mode ?? record.mode,
      messages,
      createdAt: existingChat?.createdAt ?? record.createdAt,
      updatedAt: Math.max(existingChat?.updatedAt ?? 0, record.updatedAt),
      ...(existingChat?.order === undefined ? {} : { order: existingChat.order }),
      ...(existingChat?.contextSummary === undefined
        ? {}
        : { contextSummary: existingChat.contextSummary }),
      ...(existingChat?.compactedThroughMessageId === undefined
        ? {}
        : { compactedThroughMessageId: existingChat.compactedThroughMessageId }),
    };

    if (existingChatIndex >= 0) chats[existingChatIndex] = chat;
    else chats.unshift(chat);
  }

  return { ...state, chats };
};

const stripStoredFields = (document: AssistantStateDocument): AssistantState =>
  mergeStreamResults(
    {
      chats: (document.chats ?? []).map((chat) => ({ ...chat, mode: chat.mode ?? 'chat' })),
      folders: document.folders ?? [],
      activeChatId: document.activeChatId ?? null,
      activeFolderId: document.activeFolderId ?? null,
      activeMode: document.activeMode ?? 'chat',
      preferences: normalizePreferences(document.preferences),
    },
    document.streamResults,
  );

export async function getAssistantState(userUuid: string): Promise<AssistantState | null> {
  const assistantStates = await getCollection('assistantStates');
  trackMongoOperation('findOne', ASSISTANT_STATES_COLLECTION);
  const document = await assistantStates.findOne(
    { userUuid },
    { projection: { _id: 0, userUuid: 0, updatedAt: 0 } },
  );
  return document ? stripStoredFields(document as AssistantStateDocument) : null;
}

export async function saveAssistantState(
  userUuid: string,
  state: AssistantState,
): Promise<AssistantState> {
  const assistantStates = await getCollection('assistantStates');
  trackMongoOperation('findOne', ASSISTANT_STATES_COLLECTION);
  const existing = await assistantStates.findOne(
    { userUuid },
    { projection: { _id: 0, chats: 1 } },
  );
  // Compaction metadata is server-owned. A client state save may echo an old
  // summary or invent a `compactedThroughMessageId`; neither may move the
  // server-owned marker backwards.
  const serverCompaction = new Map(
    ((existing as AssistantStateDocument | null)?.chats ?? [])
      .filter((chat) => chat.contextSummary !== undefined || chat.compactedThroughMessageId !== undefined)
      .map((chat) => [
        chat.id,
        {
          contextSummary: chat.contextSummary,
          compactedThroughMessageId: chat.compactedThroughMessageId,
        },
      ]),
  );
  const chats = state.chats.map((chat) => {
    const server = serverCompaction.get(chat.id);
    const next = { ...chat };
    if (server?.contextSummary !== undefined) next.contextSummary = server.contextSummary;
    else delete next.contextSummary;
    if (server?.compactedThroughMessageId !== undefined) {
      next.compactedThroughMessageId = server.compactedThroughMessageId;
    } else delete next.compactedThroughMessageId;
    return next;
  });
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  const document: AssistantStateDocument = {
    ...state,
    chats,
    userUuid,
    updatedAt: new Date(),
  };
  await assistantStates.updateOne(
    { userUuid },
    { $set: document },
    { upsert: true },
  );
  return { ...state, chats };
}

/**
 * Store a server-authored stream result atomically. Each result gets its own
 * field so concurrent streams cannot lose each other's updates, and client
 * state saves cannot overwrite them because they never touch `streamResults`.
 */
/** Keeps the server-authored result store from growing without bound. */
const MAX_STREAM_RESULTS = 200;

export async function saveStreamResult(
  userUuid: string,
  record: StreamResultRecord,
): Promise<void> {
  const assistantStates = await getCollection('assistantStates');
  trackMongoOperation('findOne', ASSISTANT_STATES_COLLECTION);
  const existing = await assistantStates.findOne(
    { userUuid },
    { projection: { _id: 0, streamResults: 1 } },
  );
  const key = streamResultKey(record.chatId, record.messageId);
  const olderResults = Object.entries((existing as AssistantStateDocument | null)?.streamResults ?? {})
    .filter(([resultKey]) => resultKey !== key)
    .sort((left, right) => (right[1]?.updatedAt ?? 0) - (left[1]?.updatedAt ?? 0));
  const unset = Object.fromEntries(
    olderResults.slice(MAX_STREAM_RESULTS - 1).map(([resultKey]) => [`streamResults.${resultKey}`, '']),
  );
  const update: Record<string, unknown> = {
    $set: {
      [`streamResults.${key}`]: record,
      updatedAt: new Date(),
    },
    $setOnInsert: { ...createDefaultAssistantState(), userUuid },
  };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  await assistantStates.updateOne({ userUuid }, update, { upsert: true });
}

export async function deleteAssistantChat(userUuid: string, chatId: string): Promise<AssistantState> {
  const assistantStates = await getCollection('assistantStates');
  trackMongoOperation('findOne', ASSISTANT_STATES_COLLECTION);
  const document = await assistantStates.findOne(
    { userUuid },
    { projection: { _id: 0, userUuid: 0, updatedAt: 0 } },
  );
  const state = document
    ? stripStoredFields(document as AssistantStateDocument)
    : createDefaultAssistantState();
  const next: AssistantState = {
    ...state,
    chats: state.chats.filter((chat) => chat.id !== chatId),
    activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
  };
  const remainingStreamResults = Object.fromEntries(
    Object.entries((document as AssistantStateDocument | null)?.streamResults ?? {}).filter(
      ([, record]) => record.chatId !== chatId,
    ),
  );
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  await assistantStates.updateOne(
    { userUuid },
    {
      $set: {
        ...next,
        userUuid,
        updatedAt: new Date(),
        streamResults: remainingStreamResults,
      },
    },
    { upsert: true },
  );
  return mergeStreamResults(next, remainingStreamResults);
}

/**
 * Persist the server-authored compaction summary for one chat without
 * rewriting message content or stream results.
 */
export async function updateAssistantChatContext(
  userUuid: string,
  chatId: string,
  context: { contextSummary: string; compactedThroughMessageId: number },
): Promise<void> {
  const assistantStates = await getCollection('assistantStates');
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  await assistantStates.updateOne(
    { userUuid, 'chats.id': chatId },
    {
      $set: {
        'chats.$[chat].contextSummary': context.contextSummary,
        'chats.$[chat].compactedThroughMessageId': context.compactedThroughMessageId,
        updatedAt: new Date(),
      },
    },
    { arrayFilters: [{ 'chat.id': chatId }] },
  );
}
