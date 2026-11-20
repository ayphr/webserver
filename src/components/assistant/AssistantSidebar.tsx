import { useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  IconCheck,
  IconClipboardList,
  IconClipboardListFilled,
  IconFolder,
  IconFolderOpen,
  IconFolders,
  IconMessageCircle,
  IconMessageCircleFilled,
  IconPencil,
  IconPlus,
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
}

type ItemKind = 'folder' | 'chat';

type EditState = { kind: ItemKind; id: string; value: string };
type DeleteState = { kind: ItemKind; id: string };

const UNCATEGORISED_KEY = '__uncategorised__';

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
      className={`assistant-sidebar__row ${active ? 'assistant-sidebar__row--active' : ''} ${indented ? 'assistant-sidebar__row--indented' : ''} ${forceActions ? 'assistant-sidebar__row--confirming' : ''}`}
    >
      <div
        className="assistant-sidebar__main"
        role="button"
        tabIndex={editing ? -1 : 0}
        onClick={onClick}
        onKeyDown={handleMainKeyDown}
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
    </div>
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
}: AssistantSidebarProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);

  const uncategorisedChats = chats.filter((chat) => chat.folderId === null);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const activeGroupKey = activeChat ? (activeChat.folderId ?? UNCATEGORISED_KEY) : null;
  const isGroupExpanded = (key: string) => expanded.has(key) || activeGroupKey === key;

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    setEditState(null);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditState(null);
    }
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
              if (kind === 'folder') onDeleteFolder(id);
              else onDeleteChat(id);
              setDeleteState(null);
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
              setDeleteState(null);
            }}
          >
            <IconX size={14} strokeWidth={2} />
          </button>
        </>
      );
    }

    return (
      <>
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

  const renderChatRow = (chat: AssistantChat) => {
    const editing = editState?.kind === 'chat' && editState.id === chat.id;
    const isActive = chat.id === activeChatId;
    let chatIcon;
    if (chat.mode === 'task') {
      chatIcon = isActive ? (
        <IconClipboardListFilled size={15} strokeWidth={1.75} />
      ) : (
        <IconClipboardList size={15} strokeWidth={1.75} />
      );
    } else {
      chatIcon = isActive ? (
        <IconMessageCircleFilled size={15} strokeWidth={1.75} />
      ) : (
        <IconMessageCircle size={15} strokeWidth={1.75} />
      );
    }
    return (
      <Row
        key={chat.id}
        icon={chatIcon}
        label={chat.title}
        active={chat.id === activeChatId}
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

  return (
    <aside className="assistant-sidebar" aria-label="Assistant sidebar">
      <Row
        icon={<IconPlus size={16} strokeWidth={2} />}
        label="New chat"
        active={isAssistantView && activeChatId === null}
        onClick={onNewChat}
      />

      {uncategorisedChats.length > 0 && (
        <>
          <Row
            icon={<IconFolders size={16} strokeWidth={1.75} />}
            label="Uncategorised"
            onClick={() => toggleExpanded(UNCATEGORISED_KEY)}
          />
          {isGroupExpanded(UNCATEGORISED_KEY) && uncategorisedChats.map(renderChatRow)}
        </>
      )}

      {folders.map((folder) => {
        const isExpanded = isGroupExpanded(folder.id);
        const editing = editState?.kind === 'folder' && editState.id === folder.id;
        const folderChats = chats.filter((chat) => chat.folderId === folder.id);
        return (
          <div key={folder.id} className="assistant-sidebar__section">
            <Row
              icon={
                isExpanded ? (
                  <IconFolderOpen size={16} strokeWidth={1.75} />
                ) : (
                  <IconFolder size={16} strokeWidth={1.75} />
                )
              }
              label={folder.name}
              onClick={() => toggleExpanded(folder.id)}
              editing={editing}
              editValue={editing ? editState.value : ''}
              onEditChange={(value) => setEditState((prev) => (prev ? { ...prev, value } : prev))}
              onEditBlur={() => finishEditing(true)}
              onEditKeyDown={handleEditKeyDown}
              actions={renderActions('folder', folder.id, folder.name)}
              forceActions={deleteState?.kind === 'folder' && deleteState.id === folder.id}
            />
            {isExpanded && folderChats.map(renderChatRow)}
          </div>
        );
      })}
    </aside>
  );
};
