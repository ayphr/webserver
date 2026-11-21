import type { AssistantChat, AssistantFolder } from '../types/assistant';

type Orderable = { order?: number; createdAt: number };

const compareOrder = (a: Orderable, b: Orderable) =>
  (a.order ?? 0) - (b.order ?? 0) || b.createdAt - a.createdAt;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Folders are displayed in `order`, then newest-first for legacy entries. */
export const sortAssistantFolders = (folders: AssistantFolder[]) =>
  [...folders].sort(compareOrder);

/** Chats are displayed in `order` within their folder, newest-first for legacy entries. */
export const sortAssistantChats = (chats: AssistantChat[]) =>
  [...chats].sort(compareOrder);

/** Moves a folder to another folder's display position and reindexes every folder. */
export const reorderAssistantFolders = (
  folders: AssistantFolder[],
  fromId: string,
  toId: string,
): AssistantFolder[] => {
  const ordered = sortAssistantFolders(folders);
  const fromIndex = ordered.findIndex((folder) => folder.id === fromId);
  const toIndex = ordered.findIndex((folder) => folder.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return folders;

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved!);
  const orders = new Map(ordered.map((folder, index) => [folder.id, index]));
  return folders.map((folder) => {
    const order = orders.get(folder.id);
    return order === undefined ? folder : { ...folder, order };
  });
};

/**
 * Inserts a chat at a display index inside a folder group, reindexing both the
 * source and destination groups when the chat changes folders.
 */
export const placeAssistantChat = (
  chats: AssistantChat[],
  chatId: string,
  folderId: string | null,
  targetIndex: number,
  now = Date.now(),
): AssistantChat[] => {
  const chat = chats.find((item) => item.id === chatId);
  if (!chat) return chats;

  const sourceFolderId = chat.folderId;
  const sourceGroup = sortAssistantChats(
    chats.filter((item) => item.folderId === sourceFolderId),
  );
  const targetGroup =
    sourceFolderId === folderId
      ? sourceGroup
      : sortAssistantChats(chats.filter((item) => item.folderId === folderId));
  const remaining =
    sourceFolderId === folderId
      ? targetGroup.filter((item) => item.id !== chatId)
      : targetGroup;
  const index = clamp(targetIndex, 0, remaining.length);

  const finalGroup = [...remaining];
  finalGroup.splice(index, 0, { ...chat, folderId });
  const targetOrders = new Map(finalGroup.map((item, position) => [item.id, position]));

  let next = chats.map((item) => {
    const order = targetOrders.get(item.id);
    if (order === undefined) return item;
    return item.id === chatId
      ? { ...item, folderId, order, updatedAt: now }
      : { ...item, order };
  });

  if (sourceFolderId !== folderId) {
    const sourceOrders = new Map(
      sourceGroup
        .filter((item) => item.id !== chatId)
        .map((item, position) => [item.id, position]),
    );
    next = next.map((item) => {
      const order = sourceOrders.get(item.id);
      return order === undefined ? item : { ...item, order };
    });
  }

  return next;
};

/** Adds a new chat at the top of its folder without disturbing existing orders. */
export const prependAssistantChat = (chats: AssistantChat[], chat: AssistantChat): AssistantChat[] => {
  const firstOrder = chats
    .filter((item) => item.folderId === chat.folderId)
    .reduce((minimum, item) => Math.min(minimum, item.order ?? 0), 0);
  return [{ ...chat, order: firstOrder - 1 }, ...chats];
};

/** Reassigns chats to a folder, appending them after its existing chats. */
export const moveAssistantChatsToFolder = (
  chats: AssistantChat[],
  fromFolderId: string,
  toFolderId: string | null,
  now = Date.now(),
): AssistantChat[] => {
  const movedIds = new Set(
    chats.filter((item) => item.folderId === fromFolderId).map((item) => item.id),
  );
  if (movedIds.size === 0) return chats;

  const ordered = [
    ...sortAssistantChats(chats.filter((item) => item.folderId === toFolderId)),
    ...sortAssistantChats(chats.filter((item) => movedIds.has(item.id))),
  ];
  const orders = new Map(ordered.map((item, index) => [item.id, index]));
  return chats.map((item) => {
    const order = orders.get(item.id);
    if (order === undefined) return item;
    return movedIds.has(item.id)
      ? { ...item, folderId: toFolderId, order, updatedAt: now }
      : { ...item, order };
  });
};
