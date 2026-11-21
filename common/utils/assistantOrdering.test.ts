import { describe, expect, it } from 'bun:test';
import type { AssistantChat, AssistantFolder } from '../types/assistant';
import {
  moveAssistantChatsToFolder,
  placeAssistantChat,
  prependAssistantChat,
  reorderAssistantFolders,
  sortAssistantChats,
  sortAssistantFolders,
} from './assistantOrdering';

const folder = (id: string, order?: number, createdAt = 100): AssistantFolder => ({
  id,
  name: id,
  createdAt,
  ...(order === undefined ? {} : { order }),
});

const chat = (
  id: string,
  folderId: string | null,
  order?: number,
  createdAt = 100,
): AssistantChat => ({
  id,
  title: id,
  folderId,
  mode: 'chat',
  messages: [],
  createdAt,
  updatedAt: createdAt,
  ...(order === undefined ? {} : { order }),
});

const ids = (items: { id: string; order?: number }[]) => items.map((item) => item.id);

describe('assistant ordering helpers', () => {
  it('sorts legacy folders and chats newest-first, then by explicit order', () => {
    const folders = [folder('a', 1), folder('b', undefined, 300), folder('c', undefined, 200)];
    expect(ids(sortAssistantFolders(folders))).toEqual(['b', 'c', 'a']);

    const chats = [chat('a', null, 1), chat('b', null, undefined, 300), chat('c', null, undefined, 200)];
    expect(ids(sortAssistantChats(chats))).toEqual(['b', 'c', 'a']);
  });

  it('reorders folders and reindexes all of them', () => {
    const folders = [folder('a', 0), folder('b', 1), folder('c', 2)];
    const reordered = reorderAssistantFolders(folders, 'a', 'c');
    expect(ids(sortAssistantFolders(reordered))).toEqual(['b', 'c', 'a']);
    expect(sortAssistantFolders(reordered).map((item) => item.order)).toEqual([0, 1, 2]);
    expect(reorderAssistantFolders(folders, 'a', 'a')).toBe(folders);
  });

  it('reorders chats inside a folder', () => {
    const chats = [
      chat('a', null, 0),
      chat('b', null, 1),
      chat('c', null, 2),
      chat('other', 'f1', 0),
    ];
    const next = placeAssistantChat(chats, 'c', null, 0, 999);
    expect(ids(sortAssistantChats(next.filter((item) => item.folderId === null)))).toEqual(['c', 'a', 'b']);
    expect(next.find((item) => item.id === 'c')?.updatedAt).toBe(999);
    expect(next.find((item) => item.id === 'other')).toBe(chats[3]);
  });

  it('swaps adjacent chats when the second is moved up', () => {
    const chats = [chat('first', 'f1', 0), chat('second', 'f1', 1)];
    const next = placeAssistantChat(chats, 'second', 'f1', 0, 321);
    expect(ids(sortAssistantChats(next))).toEqual(['second', 'first']);
    expect(sortAssistantChats(next).map((item) => item.order)).toEqual([0, 1]);
  });

  it('moves a chat between folders and reindexes source and target groups', () => {
    const chats = [
      chat('a', 'f1', 0),
      chat('b', 'f1', 1),
      chat('c', 'f1', 2),
      chat('x', 'f2', 0),
      chat('y', 'f2', 1),
    ];
    const next = placeAssistantChat(chats, 'b', 'f2', 1, 1234);
    expect(ids(sortAssistantChats(next.filter((item) => item.folderId === 'f1')))).toEqual(['a', 'c']);
    expect(ids(sortAssistantChats(next.filter((item) => item.folderId === 'f2')))).toEqual(['x', 'b', 'y']);
    expect(next.find((item) => item.id === 'b')?.folderId).toBe('f2');
    expect(next.find((item) => item.id === 'b')?.updatedAt).toBe(1234);
  });

  it('moves a chat into the uncategorised group', () => {
    const chats = [chat('a', 'f1', 0), chat('b', null, 0)];
    const next = placeAssistantChat(chats, 'a', null, 0, 5);
    expect(ids(sortAssistantChats(next.filter((item) => item.folderId === null)))).toEqual(['a', 'b']);
    expect(next.find((item) => item.id === 'a')?.folderId).toBeNull();
  });

  it('clamps out-of-range insert indexes', () => {
    const chats = [chat('a', null, 0), chat('b', null, 1)];
    expect(ids(sortAssistantChats(placeAssistantChat(chats, 'a', null, -5)))).toEqual(['a', 'b']);
    expect(ids(sortAssistantChats(placeAssistantChat(chats, 'a', null, 50)))).toEqual(['b', 'a']);
  });

  it('prepends new chats ahead of existing ones', () => {
    const chats = [chat('a', null, 0), chat('b', null, 1)];
    const next = prependAssistantChat(chats, chat('new', null));
    expect(ids(sortAssistantChats(next))).toEqual(['new', 'a', 'b']);
  });

  it('appends chats from a deleted folder to the uncategorised group', () => {
    const chats = [
      chat('x', null, 0),
      chat('y', null, 1),
      chat('a', 'f1', 0),
      chat('b', 'f1', 1),
    ];
    const next = moveAssistantChatsToFolder(chats, 'f1', null, 777);
    expect(ids(sortAssistantChats(next.filter((item) => item.folderId === null)))).toEqual(['x', 'y', 'a', 'b']);
    expect(next.find((item) => item.id === 'a')?.updatedAt).toBe(777);
  });
});
