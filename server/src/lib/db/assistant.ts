import {
  ASSISTANT_LOCATIONS,
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_VARIANTS,
  DEFAULT_ASSISTANT_PREFERENCES,
  type AssistantLocation,
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
} from './internal';

const normalizePreferences = (
  value: AssistantPreferences | undefined,
): AssistantPreferences => {
  const defaultVariant =
    value?.defaultVariant && ASSISTANT_VARIANTS.includes(value.defaultVariant)
      ? value.defaultVariant
      : DEFAULT_ASSISTANT_PREFERENCES.defaultVariant;
  const taskLocation =
    value?.taskLocation && ASSISTANT_LOCATIONS.includes(value.taskLocation)
      ? value.taskLocation
      : DEFAULT_ASSISTANT_PREFERENCES.taskLocation;
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
    taskLocation: taskLocation as AssistantLocation,
    permissionLevel: permissionLevel as AssistantPermissionLevel,
    notificationLevel: notificationLevel as AssistantNotificationLevel,
    allowedTools: Array.isArray(value?.allowedTools)
      ? value.allowedTools.filter((tool): tool is string => typeof tool === 'string')
      : [],
  };
};

const stripStoredFields = (document: AssistantStateDocument): AssistantState => ({
  chats: document.chats.map((chat) => ({ ...chat, mode: chat.mode ?? 'chat' })),
  folders: document.folders,
  activeChatId: document.activeChatId,
  activeFolderId: document.activeFolderId,
  activeMode: document.activeMode ?? 'chat',
  preferences: normalizePreferences(document.preferences),
});

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
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  const document: AssistantStateDocument = {
    ...state,
    userUuid,
    updatedAt: new Date(),
  };
  await assistantStates.updateOne(
    { userUuid },
    { $set: document },
    { upsert: true },
  );
  return state;
}
