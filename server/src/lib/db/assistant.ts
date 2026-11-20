import type { AssistantState } from '@common';
import {
  ASSISTANT_STATES_COLLECTION,
  getCollection,
  trackMongoOperation,
  type AssistantStateDocument,
} from './internal';

const stripStoredFields = (document: AssistantStateDocument): AssistantState => ({
  chats: document.chats,
  folders: document.folders,
  activeChatId: document.activeChatId,
  activeFolderId: document.activeFolderId,
  preferences: document.preferences,
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
  const document: AssistantStateDocument = {
    ...state,
    userUuid,
    updatedAt: new Date(),
  };
  trackMongoOperation('updateOne', ASSISTANT_STATES_COLLECTION);
  await assistantStates.updateOne(
    { userUuid },
    { $set: document },
    { upsert: true },
  );
  return state;
}
