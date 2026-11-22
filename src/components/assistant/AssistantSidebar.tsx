import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
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
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  sortAssistantChats,
  sortAssistantFolders,
  type AssistantChat,
  type AssistantFolder,
} from '@common';
import {
  SidebarAction,
  SidebarDragHandle,
  SidebarRow,
  SidebarSection,
  SidebarShell,
  type SidebarRowProps,
} from '../common';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import './AssistantSidebar.css';

const PREFIX = 'assistant-sidebar' as const;

type AssistantRowProps = Omit<SidebarRowProps, 'prefix'>;

const Row = (props: AssistantRowProps) => <SidebarRow prefix={PREFIX} {...props} />;

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

// The active item must never win its own collision test, or a short upward
// chat drag resolves back to itself instead of the row above it. Folder drags
// also need to compare whole sections so their chats stay with them.
const assistantCollisionDetection: CollisionDetection = (args) => {
  const containers = args.droppableContainers.filter(
    (container) => container.id !== args.active.id,
  );

  if (args.active.data.current?.type === 'folder') {
    return closestCenter({
      ...args,
      droppableContainers: containers.filter(
        (container) => container.data.current?.type === 'folder',
      ),
    });
  }

  const pointerCollisions = pointerWithin({ ...args, droppableContainers: containers });
  return pointerCollisions.length > 0
    ? pointerCollisions
    : closestCenter({ ...args, droppableContainers: containers });
};

// Use the real pointer position for the final target. The sortable preview
// translates rows while dragging, which can make dnd-kit's collision target
// drift to the active row or a neighbouring group on a short upward move.
const resolveDropRowId = (event: DragOverEvent | DragEndEvent) => {
  const activator = event.activatorEvent as PointerEvent;
  if (typeof activator.clientX !== 'number' || typeof activator.clientY !== 'number') {
    return event.over ? String(event.over.id) : null;
  }
  const x = activator.clientX + event.delta.x;
  const y = activator.clientY + event.delta.y;
  const row = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('.assistant-sidebar__row');
  const rowId = row?.querySelector<HTMLElement>('[data-row-id]')?.dataset.rowId;
  // The faded active row still covers its original position, so prefer the
  // sensor's target when the pointer resolves back to the item being dragged.
  if (rowId && rowId !== String(event.active.id)) return rowId;
  return event.over ? String(event.over.id) : rowId;
};

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

type SortableRowProps = AssistantRowProps & {
  itemId: string;
  itemType: ItemKind;
  data: Record<string, unknown>;
  disabled?: boolean;
};

const SortableRow = ({
  itemId,
  itemType,
  data,
  disabled = false,
  rootRef,
  rowStyle,
  label,
  ...rowProps
}: SortableRowProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: itemId, data: { type: itemType, ...data }, disabled });

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
        <SidebarDragHandle
          prefix={PREFIX}
          label={label}
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} strokeWidth={1.75} />
        </SidebarDragHandle>
      }
    />
  );
};

type SortableFolderSectionProps = AssistantRowProps & {
  itemId: string;
  data: Record<string, unknown>;
  children: ReactNode;
  disabled?: boolean;
};

const SortableFolderSection = ({
  itemId,
  data,
  children,
  disabled = false,
  rowStyle,
  isDragging = false,
  ...rowProps
}: SortableFolderSectionProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: sortableIsDragging,
  } = useSortable({ id: itemId, data: { type: 'folder', ...data }, disabled });

  return (
    <SidebarSection
      prefix={PREFIX}
      rootRef={setNodeRef}
      isDragging={sortableIsDragging || isDragging}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...rowStyle,
      }}
    >
      <Row
        {...rowProps}
        isDragging={false}
        dragHandle={
          <SidebarDragHandle
            prefix={PREFIX}
            label={rowProps.label}
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          >
            <IconGripVertical size={14} strokeWidth={1.75} />
          </SidebarDragHandle>
        }
      />
      {children}
    </SidebarSection>
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
  onReorderFolders,
  onReorderChat,
  onMoveChat,
}: AssistantSidebarProps) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The sidebar grows to fit its longest visible label. Intrinsic width cannot
  // be transitioned, so measure the text and set an explicit pixel width that
  // CSS can animate when rows, titles or folders change.
  const measureSidebarWidth = useCallback(() => {
    const element = sidebarRef.current;
    if (!element) return;
    const canvas = (measureCanvasRef.current ??= document.createElement('canvas'));
    const context = canvas.getContext('2d');
    if (!context) return;

    const styles = getComputedStyle(element);
    const minWidth = parseFloat(styles.minWidth) || 0;
    const maxWidth = parseFloat(styles.maxWidth) || Number.POSITIVE_INFINITY;
    let needed = minWidth;

    element.querySelectorAll<HTMLElement>('.assistant-sidebar__label').forEach((label) => {
      const labelStyles = getComputedStyle(label);
      context.font = `${labelStyles.fontWeight} ${labelStyles.fontSize} ${labelStyles.fontFamily}`;
      const textWidth = context.measureText(label.textContent ?? '').width;
      // Keep the icon, indentation and action space the row already reserves.
      const surrounding = element.clientWidth - label.getBoundingClientRect().width;
      needed = Math.max(needed, textWidth + surrounding);
    });

    const target = Math.min(Math.max(needed, minWidth), maxWidth);
    element.style.width = `${Math.round(target)}px`;
  }, []);

  useLayoutEffect(() => {
    measureSidebarWidth();
  }, [
    measureSidebarWidth,
    chats,
    folders,
    query,
    expanded,
    editState,
    deleteState,
    activeChatId,
  ]);

  useEffect(() => {
    window.addEventListener('resize', measureSidebarWidth);
    return () => window.removeEventListener('resize', measureSidebarWidth);
  }, [measureSidebarWidth]);

  const hasSavedChats = chats.length > 0;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const isSearching = hasSavedChats && normalizedQuery.length > 0;

  useEffect(() => {
    if (hasSavedChats) return;
    // Reset local search state so it does not reappear when a chat is saved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
  }, [hasSavedChats]);

  // Search is local UI state: derive every visible list from the matching chats
  // so rendering, keyboard rows and folder sections stay in sync.
  const { filteredChats, visibleFolders } = useMemo(() => {
    if (!isSearching) {
      return { filteredChats: chats, visibleFolders: sortAssistantFolders(folders) };
    }
    const folderNames = new Map(
      folders.map((folder) => [folder.id, folder.name.toLocaleLowerCase()]),
    );
    const matches = (chat: AssistantChat) =>
      chat.title.toLocaleLowerCase().includes(normalizedQuery) ||
      (chat.folderId !== null &&
        (folderNames.get(chat.folderId)?.includes(normalizedQuery) ?? false)) ||
      chat.messages.some((message) =>
        message.content.toLocaleLowerCase().includes(normalizedQuery),
      );
    const nextChats = chats.filter(matches);
    return {
      filteredChats: nextChats,
      visibleFolders: sortAssistantFolders(
        folders.filter((folder) => nextChats.some((chat) => chat.folderId === folder.id)),
      ),
    };
  }, [chats, folders, isSearching, normalizedQuery]);

  useEffect(() => {
    if (!isSearching) return;
    // Search results inside collapsed folders would otherwise be invisible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((previous) => {
      const next = new Set(previous);
      let changed = false;
      filteredChats.forEach((chat) => {
        const key = groupKeyForChat(chat);
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [filteredChats, isSearching]);

  // Folder sections contain their chats, so the default getter can pick a
  // nested chat as the next target. Walk the folder sections directly instead.
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback(
    (event, args) => {
      if (args.context.active?.data.current?.type !== 'folder') {
        return sortableKeyboardCoordinates(event, args);
      }
      if (event.code !== 'ArrowDown' && event.code !== 'ArrowUp') {
        return sortableKeyboardCoordinates(event, args);
      }
      event.preventDefault();
      const folderIds = visibleFolders.map((folder) => folderRowId(folder.id));
      const overId = args.context.over ? String(args.context.over.id) : folderIds[0];
      const currentIndex = folderIds.indexOf(overId);
      if (currentIndex < 0) return undefined;
      const nextIndex =
        event.code === 'ArrowDown'
          ? Math.min(currentIndex + 1, folderIds.length - 1)
          : Math.max(currentIndex - 1, 0);
      if (nextIndex === currentIndex) return undefined;
      const rect = rowRefs.current
        .get(folderIds[nextIndex])
        ?.closest<HTMLElement>('.assistant-sidebar__section')
        ?.getBoundingClientRect();
      return rect ? { x: rect.left, y: rect.top } : undefined;
    },
    [visibleFolders],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const uncategorisedChats = sortAssistantChats(
    filteredChats.filter((chat) => chat.folderId === null),
  );
  const visibleChatsIn = (folderId: string) =>
    sortAssistantChats(filteredChats.filter((chat) => chat.folderId === folderId));
  // Outside search, keep the empty uncategorised section as a move target.
  const showUncategorised =
    uncategorisedChats.length > 0 || (!isSearching && chats.length > 0);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const activeGroupKey = activeChat ? groupKeyForChat(activeChat) : null;
  const isGroupExpanded = (key: string) => expanded.has(key) || activeGroupKey === key;

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
  // Always offer the uncategorised group as a drop target so chats can be
  // moved out of every folder, even when the group is currently empty.
  if (showUncategorised) {
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
      if (!target) return;
      event.preventDefault();
      setEditState(null);
      setDeleteState(null);
      scheduleFocus(rowIdForItem(target.kind, target.id));
    },
    [deleteState, editState, scheduleFocus],
  );

  const clearSearch = () => {
    setQuery('');
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setQuery('');
  };

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
          <span className="sidebar-list__confirm-hint assistant-sidebar__confirm-hint">Confirm?</span>
          <SidebarAction
            prefix={PREFIX}
            aria-label={`Confirm delete ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              confirmDelete(kind, id);
            }}
          >
            <IconCheck size={14} strokeWidth={2} />
          </SidebarAction>
          <SidebarAction
            prefix={PREFIX}
            aria-label={`Cancel delete ${name}`}
            onClick={(event) => {
              event.stopPropagation();
              cancelDelete(kind, id);
            }}
          >
            <IconX size={14} strokeWidth={2} />
          </SidebarAction>
        </>
      );
    }

    return (
      <>
        <SidebarAction
          prefix={PREFIX}
          aria-label={`Rename ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            startEditing(kind, id, name);
          }}
        >
          <IconPencil size={14} strokeWidth={1.75} />
        </SidebarAction>
        <SidebarAction
          prefix={PREFIX}
          aria-label={`Delete ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            setEditState(null);
            setDeleteState({ kind, id });
          }}
        >
          <IconTrash size={14} strokeWidth={1.75} />
        </SidebarAction>
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
        disabled={isSearching || dragState?.kind === 'folder'}
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
    setEditState(null);
    setDeleteState(null);
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
    if (dragState?.kind !== 'chat') return;
    setDropTargetKey(resolveGroupKey(resolveDropRowId(event)));
  };

  const dropChat = (chat: AssistantChat, overId: string | null) => {
    const groupKey = resolveGroupKey(overId);
    if (!groupKey) return;
    const groupChats = sortAssistantChats(
      chats.filter((item) => groupKeyForChat(item) === groupKey),
    );
    const folderId = groupKey === UNCATEGORISED_KEY ? null : groupKey;
    let targetIndex = groupChats.length;
    if (overId?.startsWith('chat:')) {
      const overChat = chats.find((item) => item.id === overId.slice('chat:'.length));
      const overIndex = overChat ? groupChats.findIndex((item) => item.id === overChat.id) : -1;
      if (overIndex < 0) return;
      targetIndex = overIndex;
    }
    if (folderId === chat.folderId) {
      onReorderChat(chat.id, folderId, targetIndex);
      return;
    }
    onMoveChat(chat.id, folderId, targetIndex);
    // Reveal the chat after a cross-folder move, even if the folder was closed.
    setExpanded((prev) => new Set(prev).add(groupKey));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = resolveDropRowId(event);
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
    <SidebarShell
      ref={sidebarRef}
      prefix={PREFIX}
      ariaLabel="Assistant sidebar"
      onKeyDown={handleSidebarKeyDown}
    >
      {hasSavedChats && (
        <div className="sidebar-list__row assistant-sidebar__search">
          <div className="sidebar-list__main assistant-sidebar__search-main">
            <span className="sidebar-list__icon assistant-sidebar__search-icon" aria-hidden="true">
              <IconSearch size={16} strokeWidth={1.75} />
            </span>
            <input
              id="assistant-sidebar-search-input"
              ref={searchInputRef}
              className="sidebar-list__edit assistant-sidebar__search-input"
              type="text"
              value={query}
              placeholder="Search chats"
              aria-label="Search chats"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {isSearching && (
              <span className="assistant-sidebar__search-count" aria-live="polite">
                {filteredChats.length}
              </span>
            )}
            {query && (
              <button
                type="button"
                className="assistant-sidebar__search-clear"
                aria-label="Clear search"
                onClick={clearSearch}
              >
                <IconX size={14} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={assistantCollisionDetection}
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

        {isSearching && filteredChats.length === 0 && (
          <div className="assistant-sidebar__no-results">No matching chats</div>
        )}

        {showUncategorised && (
          <UncategorisedRow
            {...rowCommonProps(groupRowId(UNCATEGORISED_KEY), 'Uncategorised')}
            icon={<IconFolders size={16} strokeWidth={1.75} />}
            onClick={() => toggleExpanded(UNCATEGORISED_KEY)}
            ariaExpanded={uncategorisedChats.length > 0 ? isGroupExpanded(UNCATEGORISED_KEY) : undefined}
            isDropTarget={dragState?.kind === 'chat' && dropTargetKey === UNCATEGORISED_KEY}
            dropDisabled={isSearching || dragState?.kind === 'folder'}
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
              <SortableFolderSection
                key={folder.id}
                {...rowCommonProps(id, folder.name)}
                itemId={id}
                data={{ folderId: folder.id }}
                disabled={isSearching}
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
              >
                <SortableContext
                  items={visibleChatsIn(folder.id).map((chat) => chatRowId(chat.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {isExpanded && visibleChatsIn(folder.id).map(renderChatRow)}
                </SortableContext>
              </SortableFolderSection>
            );
          })}
        </SortableContext>

        {createPortal(
          <DragOverlay
            dropAnimation={
              prefersReducedMotion ? { duration: 0, easing: 'linear' } : { duration: 180, easing: 'ease' }
            }
            style={{ pointerEvents: 'none' }}
          >
            {dragState && (
              <SidebarRow
                prefix={PREFIX}
                className="sidebar-list__row--overlay assistant-sidebar__row--overlay"
                icon={dragState.icon}
                label={dragState.label}
              />
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </SidebarShell>
  );
};

type UncategorisedRowProps = AssistantRowProps & { children: ReactNode; dropDisabled?: boolean };

const UncategorisedRow = ({
  children,
  rootRef,
  dropDisabled = false,
  ...rowProps
}: UncategorisedRowProps) => {
  const { setNodeRef } = useDroppable({
    id: groupRowId(UNCATEGORISED_KEY),
    disabled: dropDisabled,
  });
  const handleRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    rootRef?.(node);
  };
  return (
    <SidebarSection prefix={PREFIX} rootRef={handleRef}>
      <Row {...rowProps} />
      {children}
    </SidebarSection>
  );
};
