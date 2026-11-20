import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconCheck,
  IconClipboardList,
  IconClipboardListFilled,
  IconFolder,
  IconFolderOpen,
  IconFolders,
  IconGripVertical,
  IconMessageCircle,
  IconMessageCircleFilled,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import type { AssistantChat, AssistantFolder } from '@common';
import './AssistantSidebar.css';

export interface AssistantSidebarProps {
  folders: AssistantFolder[];
  chats: AssistantChat[];
  activeChatId: string | null;
  isAssistantView: boolean;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onTogglePinChat: (chatId: string) => void;
  onReorderFolders: (fromId: string, toId: string) => void;
  onReorderChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
  onMoveChat: (chatId: string, folderId: string | null, targetIndex: number) => void;
}

type ItemKind = 'folder' | 'chat';

type EditState = { kind: ItemKind; id: string; value: string };
type DeleteState = { kind: ItemKind; id: string };
type DragState = { kind: ItemKind; id: string; label: string; icon: ReactNode };

const UNCATEGORISED_KEY = '__uncategorised__';
const NEW_CHAT_ROW = 'new-chat';

const folderRowId = (id: string) => `folder:${id}`;
const chatRowId = (id: string) => `chat:${id}`;
const groupRowId = (key: string) => `group:${key}`;
const groupKeyForChat = (chat: AssistantChat) => chat.folderId ?? UNCATEGORISED_KEY;
const rowIdForItem = (kind: ItemKind, id: string) =>
  kind === 'folder' ? folderRowId(id) : chatRowId(id);

const sortFolders = (folders: AssistantFolder[]) =>
  [...folders].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || b.createdAt - a.createdAt,
  );

const sortChats = (chats: AssistantChat[]) =>
  [...chats].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      b.createdAt - a.createdAt,
  );

const chatIcon = (chat: AssistantChat, isActive: boolean) => {
  if (chat.mode === 'task') {
    return isActive ? (
      <IconClipboardListFilled size={15} strokeWidth={1.75} />
    ) : (
      <IconClipboardList size={15} strokeWidth={1.75} />
    );
  }
  return isActive ? (
    <IconMessageCircleFilled size={15} strokeWidth={1.75} />
  ) : (
    <IconMessageCircle size={15} strokeWidth={1.75} />
  );
};

type RowProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  indented?: boolean;
  onClick: () => void;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditBlur?: () => void;
  onEditKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  actions?: ReactNode;
  forceActions?: boolean;
  dragHandle?: ReactNode;
  rootRef?: (node: HTMLDivElement | null) => void;
  rowStyle?: CSSProperties;
  isDragging?: boolean;
  isDropTarget?: boolean;
  rowId?: string;
  tabIndex?: number;
  onRowFocus?: () => void;
  ariaExpanded?: boolean;
  ariaCurrent?: boolean;
};

const Row = ({
  icon,
  label,
  active = false,
  indented = false,
  onClick,
  editing = false,
  editValue = '',
  onEditChange,
  onEditBlur,
  onEditKeyDown,
  actions,
  forceActions = false,
  dragHandle,
  rootRef,
  rowStyle,
  isDragging = false,
  isDropTarget = false,
  rowId,
  tabIndex = 0,
  onRowFocus,
  ariaExpanded,
  ariaCurrent = false,
}: RowProps) => {
  const handleMainKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`assistant-sidebar__row ${active ? 'assistant-sidebar__row--active' : ''} ${indented ? 'assistant-sidebar__row--indented' : ''} ${forceActions ? 'assistant-sidebar__row--confirming' : ''} ${isDragging ? 'assistant-sidebar__row--dragging' : ''} ${isDropTarget ? 'assistant-sidebar__row--drop-target' : ''}`}
      style={rowStyle}
    >
      <div
        className="assistant-sidebar__main"
        role="button"
        data-row-id={rowId}
        tabIndex={tabIndex}
        aria-expanded={ariaExpanded}
        aria-current={ariaCurrent ? 'true' : undefined}
        onClick={onClick}
        onKeyDown={handleMainKeyDown}
        onFocus={onRowFocus}
      >
        <span className="assistant-sidebar__icon">{icon}</span>
        {editing ? (
          <input
            autoFocus
            className="assistant-sidebar__edit"
            value={editValue}
            onChange={(event) => onEditChange?.(event.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Rename ${label}`}
          />
        ) : (
          <span className="assistant-sidebar__label">{label}</span>
        )}
      </div>
      {actions && <div className="assistant-sidebar__actions">{actions}</div>}
      {dragHandle && <div className="assistant-sidebar__drag">{dragHandle}</div>}
    </div>
  );
};

type SortableRowProps = RowProps & {
  itemId: string;
  itemType: ItemKind;
  data: Record<string, unknown>;
};

const SortableRow = ({
  itemId,
  itemType,
  data,
  rootRef,
  rowStyle,
  label,
  ...rowProps
}: SortableRowProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemId, data: { type: itemType, ...data } });

  const handleRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    rootRef?.(node);
  };

  return (
    <Row
      {...rowProps}
      label={label}
      rootRef={handleRef}
      rowStyle={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...rowStyle,
      }}
      isDragging={isDragging || rowProps.isDragging}
      dragHandle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="assistant-sidebar__drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${label}`}
        >
          <IconGripVertical size={14} strokeWidth={1.75} />
        </button>
      }
    />
  );
};

export const AssistantSidebar = ({
  folders,
  chats,
  activeChatId,
  isAssistantView,
  onNewChat,
  onOpenChat,
  onRenameFolder,
  onDeleteFolder,
  onRenameChat,
  onDeleteChat,
  onTogglePinChat,
  onReorderFolders,
  onReorderChat,
  onMoveChat,
}: AssistantSidebarProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [query, setQuery] = useState('');
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const folderMatches = (folder: AssistantFolder) =>
    !isSearching || folder.name.toLowerCase().includes(normalizedQuery);
  const chatMatches = (chat: AssistantChat) => {
    if (!isSearching) return true;
    if (chat.title.toLowerCase().includes(normalizedQuery)) return true;
    const folder = folders.find((item) => item.id === chat.folderId);
    return Boolean(folder && folder.name.toLowerCase().includes(normalizedQuery));
  };

  const visibleFolders = sortFolders(folders).filter(folderMatches);
  const uncategorisedChats = sortChats(
    chats.filter((chat) => chat.folderId === null && chatMatches(chat)),
  );
  const visibleChatsIn = (folderId: string) =>
    sortChats(chats.filter((chat) => chat.folderId === folderId && chatMatches(chat)));

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const activeGroupKey = activeChat ? groupKeyForChat(activeChat) : null;
  const isGroupExpanded = (key: string) =>
    isSearching || expanded.has(key) || activeGroupKey === key;

  useEffect(() => {
    if (!activeGroupKey) return;
    // Keep a group open once its chat has been active, so starting a new chat
    // does not collapse the folder the previous chat lived in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((prev) => {
      if (prev.has(activeGroupKey)) return prev;
      const next = new Set(prev);
      next.add(activeGroupKey);
      return next;
    });
  }, [activeGroupKey]);

  const rowIds: string[] = [NEW_CHAT_ROW];
  if (uncategorisedChats.length > 0) {
    rowIds.push(groupRowId(UNCATEGORISED_KEY));
    if (isGroupExpanded(UNCATEGORISED_KEY)) {
      uncategorisedChats.forEach((chat) => rowIds.push(chatRowId(chat.id)));
    }
  }
  visibleFolders.forEach((folder) => {
    rowIds.push(folderRowId(folder.id));
    if (isGroupExpanded(folder.id)) {
      visibleChatsIn(folder.id).forEach((chat) => rowIds.push(chatRowId(chat.id)));
    }
  });

  const activeRowId =
    focusedRowId && rowIds.includes(focusedRowId) ? focusedRowId : (rowIds[0] ?? null);
  const registerRow = (id: string) => (node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  };
  const focusRow = useCallback((id: string | null) => {
    if (!id) return;
    rowRefs.current
      .get(id)
      ?.querySelector<HTMLElement>('.assistant-sidebar__main')
      ?.focus();
  }, []);
  const scheduleFocus = useCallback((id: string | null) => {
    if (!id) return;
    setFocusedRowId(id);
    requestAnimationFrame(() => {
      rowRefs.current
        .get(id)
        ?.querySelector<HTMLElement>('.assistant-sidebar__main')
        ?.focus();
    });
  }, []);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleEscape = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = editState ?? deleteState;
      if (target) {
        event.preventDefault();
        setEditState(null);
        setDeleteState(null);
        scheduleFocus(rowIdForItem(target.kind, target.id));
      } else if (query) {
        event.preventDefault();
        setQuery('');
        searchInputRef.current?.focus();
      }
    },
    [deleteState, editState, query, scheduleFocus],
  );

  const handleSidebarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      handleEscape(event);
      return;
    }
    if (event.defaultPrevented || dragState || editState || deleteState) return;
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }

    const target = event.target as HTMLElement;
    const main = target.closest<HTMLElement>('.assistant-sidebar__main');
    if (!main || !event.currentTarget.contains(main) || main.querySelector('input')) return;
    const id = main.dataset.rowId;
    const index = id ? rowIds.indexOf(id) : -1;
    if (index < 0) return;

    let nextIndex: number;
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, rowIds.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else nextIndex = rowIds.length - 1;

    event.preventDefault();
    const nextId = rowIds[nextIndex];
    setFocusedRowId(nextId);
    focusRow(nextId);
  };

  const startEditing = (kind: ItemKind, id: string, value: string) => {
    setDeleteState(null);
    setEditState({ kind, id, value });
  };

  const finishEditing = (save: boolean) => {
    if (!editState) return;
    const value = editState.value.trim();
    if (save && value) {
      if (editState.kind === 'folder') onRenameFolder(editState.id, value);
      else onRenameChat(editState.id, value);
    }
    const target = rowIdForItem(editState.kind, editState.id);
    setEditState(null);
    scheduleFocus(target);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const target = editState ? rowIdForItem(editState.kind, editState.id) : null;
      setEditState(null);
      scheduleFocus(target);
    }
  };

  const confirmDelete = (kind: ItemKind, id: string) => {
    const currentId = rowIdForItem(kind, id);
    const index = rowIds.indexOf(currentId);
    const neighbour = rowIds[index + 1] ?? rowIds[index - 1] ?? null;
    if (kind === 'folder') onDeleteFolder(id);
    else onDeleteChat(id);
    setDeleteState(null);
    scheduleFocus(neighbour);
  };

  const cancelDelete = (kind: ItemKind, id: string) => {
    setDeleteState(null);
    scheduleFocus(rowIdForItem(kind, id));
  };

  const renderActions = (kind: ItemKind, id: string, name: string) => {
    if (editState?.kind === kind && editState.id === id) return undefined;

    if (deleteState?.kind === kind && deleteState.id === id) {
      return (
        <>
          <span className="assistant-sidebar__confirm-hint">Confirm?</span>
          <button
            type="button"
            className="assistant-sidebar__action"
            aria-label={`Confirm delete ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              confirmDelete(kind, id);
            }}
          >
            <IconCheck size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="assistant-sidebar__action"
            aria-label={`Cancel delete ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              cancelDelete(kind, id);
            }}
          >
            <IconX size={14} strokeWidth={2} />
          </button>
        </>
      );
    }

    const chat = kind === 'chat' ? chats.find((item) => item.id === id) : undefined;
    return (
      <>
        {chat && (
          <button
            type="button"
            className="assistant-sidebar__action"
            aria-label={`${chat.pinned ? 'Unpin' : 'Pin'} ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinChat(id);
            }}
          >
            {chat.pinned ? (
              <IconPinFilled size={14} strokeWidth={1.75} />
            ) : (
              <IconPin size={14} strokeWidth={1.75} />
            )}
          </button>
        )}
        <button
          type="button"
          className="assistant-sidebar__action"
          aria-label={`Rename ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            startEditing(kind, id, name);
          }}
        >
          <IconPencil size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="assistant-sidebar__action"
          aria-label={`Delete ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            setEditState(null);
            setDeleteState({ kind, id });
          }}
        >
          <IconTrash size={14} strokeWidth={1.75} />
        </button>
      </>
    );
  };

  const rowCommonProps = (id: string, label: string) => ({
    label,
    rowId: id,
    tabIndex: id === activeRowId ? 0 : -1,
    onRowFocus: () => setFocusedRowId(id),
    rootRef: registerRow(id),
  });

  const renderChatRow = (chat: AssistantChat) => {
    const id = chatRowId(chat.id);
    const editing = editState?.kind === 'chat' && editState.id === chat.id;
    const isActive = chat.id === activeChatId;
    return (
      <SortableRow
        key={id}
        {...rowCommonProps(id, chat.title)}
        itemId={id}
        itemType="chat"
        data={{ chatId: chat.id, folderId: chat.folderId }}
        icon={chatIcon(chat, isActive)}
        active={isActive}
        indented
        onClick={() => onOpenChat(chat.id)}
        editing={editing}
        editValue={editing ? editState.value : ''}
        onEditChange={(value) => setEditState((prev) => (prev ? { ...prev, value } : prev))}
        onEditBlur={() => finishEditing(true)}
        onEditKeyDown={handleEditKeyDown}
        actions={renderActions('chat', chat.id, chat.title)}
        forceActions={deleteState?.kind === 'chat' && deleteState.id === chat.id}
      />
    );
  };

  const resolveGroupKey = (overId: string | null | undefined): string | null => {
    if (!overId) return null;
    if (overId.startsWith('group:')) return overId.slice('group:'.length);
    if (overId.startsWith('folder:')) return overId.slice('folder:'.length);
    if (overId.startsWith('chat:')) {
      const overChat = chats.find((item) => item.id === overId.slice('chat:'.length));
      return overChat ? groupKeyForChat(overChat) : null;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDropTargetKey(null);
    if (id.startsWith('chat:')) {
      const chat = chats.find((item) => item.id === id.slice('chat:'.length));
      if (chat) {
        setDragState({ kind: 'chat', id: chat.id, label: chat.title, icon: chatIcon(chat, false) });
      }
    } else if (id.startsWith('folder:')) {
      const folder = folders.find((item) => item.id === id.slice('folder:'.length));
      if (folder) {
        setDragState({
          kind: 'folder',
          id: folder.id,
          label: folder.name,
          icon: <IconFolderOpen size={16} strokeWidth={1.75} />,
        });
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    setDropTargetKey(resolveGroupKey(event.over ? String(event.over.id) : null));
  };

  const dropChat = (chat: AssistantChat, overId: string | null) => {
    const groupKey = resolveGroupKey(overId);
    if (!groupKey) return;
    const groupChats = sortChats(chats.filter((item) => groupKeyForChat(item) === groupKey));
    const folderId = groupKey === UNCATEGORISED_KEY ? null : groupKey;
    let targetIndex = groupChats.length;
    if (overId?.startsWith('chat:')) {
      const overChat = chats.find((item) => item.id === overId.slice('chat:'.length));
      const overIndex = overChat ? groupChats.findIndex((item) => item.id === overChat.id) : -1;
      if (overIndex < 0) return;
      targetIndex = overIndex;
    }
    if (folderId === chat.folderId) onReorderChat(chat.id, folderId, targetIndex);
    else onMoveChat(chat.id, folderId, targetIndex);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    setDragState(null);
    setDropTargetKey(null);
    if (!overId || activeId === overId) return;

    if (activeId.startsWith('folder:')) {
      const fromId = activeId.slice('folder:'.length);
      if (overId.startsWith('folder:')) {
        const toId = overId.slice('folder:'.length);
        if (toId !== fromId) onReorderFolders(fromId, toId);
      }
      return;
    }

    if (activeId.startsWith('chat:')) {
      const chat = chats.find((item) => item.id === activeId.slice('chat:'.length));
      if (chat) dropChat(chat, overId);
    }
  };

  const handleDragCancel = () => {
    setDragState(null);
    setDropTargetKey(null);
  };

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Assistant sidebar"
      onKeyDown={handleSidebarKeyDown}
    >
      <div className="assistant-sidebar__search">
        <IconSearch size={14} strokeWidth={1.75} className="assistant-sidebar__search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="assistant-sidebar__search-input"
          aria-label="Search chats and folders"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="assistant-sidebar__search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              searchInputRef.current?.focus();
            }}
          >
            <IconX size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <Row
          icon={<IconPlus size={16} strokeWidth={2} />}
          active={isAssistantView && activeChatId === null}
          onClick={onNewChat}
          {...rowCommonProps(NEW_CHAT_ROW, 'New chat')}
        />

        {uncategorisedChats.length > 0 && (
          <UncategorisedRow
            {...rowCommonProps(groupRowId(UNCATEGORISED_KEY), 'Uncategorised')}
            icon={<IconFolders size={16} strokeWidth={1.75} />}
            onClick={() => toggleExpanded(UNCATEGORISED_KEY)}
            ariaExpanded={isGroupExpanded(UNCATEGORISED_KEY)}
            isDropTarget={
              dragState?.kind === 'chat' && dropTargetKey === UNCATEGORISED_KEY
            }
          >
            <SortableContext
              items={uncategorisedChats.map((chat) => chatRowId(chat.id))}
              strategy={verticalListSortingStrategy}
            >
              {isGroupExpanded(UNCATEGORISED_KEY) && uncategorisedChats.map(renderChatRow)}
            </SortableContext>
          </UncategorisedRow>
        )}

        <SortableContext
          items={visibleFolders.map((folder) => folderRowId(folder.id))}
          strategy={verticalListSortingStrategy}
        >
          {visibleFolders.map((folder) => {
            const isExpanded = isGroupExpanded(folder.id);
            const editing = editState?.kind === 'folder' && editState.id === folder.id;
            const id = folderRowId(folder.id);
            return (
              <div key={folder.id} className="assistant-sidebar__section">
                <SortableRow
                  {...rowCommonProps(id, folder.name)}
                  itemId={id}
                  itemType="folder"
                  data={{ folderId: folder.id }}
                  icon={
                    isExpanded ? (
                      <IconFolderOpen size={16} strokeWidth={1.75} />
                    ) : (
                      <IconFolder size={16} strokeWidth={1.75} />
                    )
                  }
                  onClick={() => toggleExpanded(folder.id)}
                  editing={editing}
                  editValue={editing ? editState.value : ''}
                  onEditChange={(value) =>
                    setEditState((prev) => (prev ? { ...prev, value } : prev))
                  }
                  onEditBlur={() => finishEditing(true)}
                  onEditKeyDown={handleEditKeyDown}
                  actions={renderActions('folder', folder.id, folder.name)}
                  forceActions={deleteState?.kind === 'folder' && deleteState.id === folder.id}
                  ariaExpanded={isExpanded}
                  isDropTarget={dragState?.kind === 'chat' && dropTargetKey === folder.id}
                />
                <SortableContext
                  items={visibleChatsIn(folder.id).map((chat) => chatRowId(chat.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {isExpanded && visibleChatsIn(folder.id).map(renderChatRow)}
                </SortableContext>
              </div>
            );
          })}
        </SortableContext>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
          {dragState && (
            <div className="assistant-sidebar__row assistant-sidebar__row--overlay">
              <div className="assistant-sidebar__main">
                <span className="assistant-sidebar__icon">{dragState.icon}</span>
                <span className="assistant-sidebar__label">{dragState.label}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </aside>
  );
};

type UncategorisedRowProps = RowProps & { children: ReactNode };

const UncategorisedRow = ({ children, rootRef, ...rowProps }: UncategorisedRowProps) => {
  const { setNodeRef } = useDroppable({ id: groupRowId(UNCATEGORISED_KEY) });
  const handleRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    rootRef?.(node);
  };
  return (
    <div className="assistant-sidebar__section">
      <Row {...rowProps} rootRef={handleRef} />
      {children}
    </div>
  );
};
