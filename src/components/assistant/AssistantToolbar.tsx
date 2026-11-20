import { useEffect, useRef, useState } from 'react';
import {
  IconCheck,
  IconFolder,
  IconMessageCircle,
  IconPencil,
  IconPlus,
} from '@tabler/icons-react';
import type { AssistantChat, AssistantFolder } from '@common';
import { Input, Modal } from '../common';
import './AssistantToolbar.css';

export interface AssistantToolbarProps {
  isChat: boolean;
  folders: AssistantFolder[];
  chats: AssistantChat[];
  activeFolderId: string | null;
  activeChatId: string | null;
  currentChatTitle: string;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameChat: (title: string) => void;
}

type ToolbarMenu = 'folder' | 'chat' | null;

export const AssistantToolbar = ({
  isChat,
  folders,
  chats,
  activeFolderId,
  activeChatId,
  currentChatTitle,
  onNewChat,
  onOpenChat,
  onSelectFolder,
  onCreateFolder,
  onRenameChat,
}: AssistantToolbarProps) => {
  const [menu, setMenu] = useState<ToolbarMenu>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTitle, setRenameTitle] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setMenu(null);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menu]);

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  const handleSelectFolder = (id: string | null) => {
    onSelectFolder(id);
    setMenu(null);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    setNewFolderName('');
    setFolderModalOpen(false);
    setMenu(null);
  };

  const handleOpenRename = () => {
    setRenameTitle(currentChatTitle);
    setRenameModalOpen(true);
    setMenu(null);
  };

  const handleRename = () => {
    const title = renameTitle.trim();
    if (!title) return;
    onRenameChat(title);
    setRenameModalOpen(false);
  };

  return (
    <>
      <div className="assistant-toolbar" ref={toolbarRef}>
        {isChat && (
          <div className="assistant-toolbar__group">
            <button
              type="button"
              className="assistant-toolbar__item"
              onClick={onNewChat}
              aria-label="New chat"
            >
              <IconPlus size={15} strokeWidth={2} />
              <span>New chat</span>
            </button>
          </div>
        )}

        <div className="assistant-toolbar__group">
          <button
            type="button"
            className={`assistant-toolbar__item ${menu === 'folder' ? 'assistant-toolbar__item--open' : ''}`}
            onClick={() => setMenu((prev) => (prev === 'folder' ? null : 'folder'))}
            aria-haspopup="menu"
            aria-expanded={menu === 'folder'}
          >
            <IconFolder size={16} strokeWidth={1.75} />
            <span className="assistant-toolbar__label">{activeFolder?.name ?? 'No folder'}</span>
          </button>
          {menu === 'folder' && (
            <div className="assistant-menu" role="menu">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={activeFolderId === null}
                className={`assistant-menu__item ${activeFolderId === null ? 'assistant-menu__item--selected' : ''}`}
                onClick={() => handleSelectFolder(null)}
              >
                <span className="assistant-menu__text">No folder</span>
                {activeFolderId === null && <IconCheck size={14} strokeWidth={2} className="assistant-menu__check" />}
              </button>
              {folders.map((folder) => {
                const selected = activeFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`assistant-menu__item ${selected ? 'assistant-menu__item--selected' : ''}`}
                    onClick={() => handleSelectFolder(folder.id)}
                  >
                    <span className="assistant-menu__text">{folder.name}</span>
                    {selected && <IconCheck size={14} strokeWidth={2} className="assistant-menu__check" />}
                  </button>
                );
              })}
              <div className="assistant-menu__divider" />
              <button
                type="button"
                role="menuitem"
                className="assistant-menu__item assistant-menu__item--action"
                onClick={() => {
                  setNewFolderName('');
                  setFolderModalOpen(true);
                  setMenu(null);
                }}
              >
                <IconPlus size={14} strokeWidth={2} />
                <span>New folder</span>
              </button>
            </div>
          )}
        </div>

        <div className="assistant-toolbar__group">
          <button
            type="button"
            className={`assistant-toolbar__item ${menu === 'chat' ? 'assistant-toolbar__item--open' : ''}`}
            onClick={() => setMenu((prev) => (prev === 'chat' ? null : 'chat'))}
            aria-haspopup="menu"
            aria-expanded={menu === 'chat'}
          >
            <IconMessageCircle size={16} strokeWidth={1.75} />
            <span className="assistant-toolbar__label">{currentChatTitle}</span>
          </button>
          {menu === 'chat' && (
            <div className="assistant-menu assistant-menu--chats" role="menu">
              {chats.length === 0 ? (
                <div className="assistant-menu__empty">No chats yet</div>
              ) : (
                chats.map((chat) => {
                  const selected = chat.id === activeChatId;
                  const folder = folders.find((item) => item.id === chat.folderId);
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`assistant-menu__item ${selected ? 'assistant-menu__item--selected' : ''}`}
                      onClick={() => {
                        onOpenChat(chat.id);
                        setMenu(null);
                      }}
                    >
                      <span className="assistant-menu__text">{chat.title}</span>
                      {folder && <span className="assistant-menu__hint">{folder.name}</span>}
                      {selected && <IconCheck size={14} strokeWidth={2} className="assistant-menu__check" />}
                    </button>
                  );
                })
              )}
              {isChat && (
                <>
                  <div className="assistant-menu__divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="assistant-menu__item assistant-menu__item--action"
                    onClick={handleOpenRename}
                  >
                    <IconPencil size={14} strokeWidth={2} />
                    <span>Rename</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        onConfirm={handleCreateFolder}
        title="New folder"
        size="sm"
        confirmText="Create folder"
        confirmDisabled={!newFolderName.trim()}
      >
        <Input
          autoFocus
          fullWidth
          label="Folder name"
          placeholder="e.g. Projects"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder();
          }}
        />
      </Modal>

      <Modal
        isOpen={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        onConfirm={handleRename}
        title="Rename chat"
        size="sm"
        confirmText="Save"
        confirmDisabled={!renameTitle.trim()}
      >
        <Input
          autoFocus
          fullWidth
          label="Chat name"
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && renameTitle.trim()) handleRename();
          }}
        />
      </Modal>
    </>
  );
};
