import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconFolder, IconFolders, IconPlus } from '@tabler/icons-react';
import type { AssistantFolder } from '@common';
import { Input, Modal } from '../common';
import './AssistantToolbar.css';

export interface AssistantToolbarProps {
  folders: AssistantFolder[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string) => void;
}

export const AssistantToolbar = ({
  folders,
  activeFolderId,
  onSelectFolder,
  onCreateFolder,
}: AssistantToolbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  const handleSelectFolder = (folderId: string | null) => {
    onSelectFolder(folderId);
    setMenuOpen(false);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    setNewFolderName('');
    setFolderModalOpen(false);
    setMenuOpen(false);
  };

  return (
    <>
      <div className="assistant-toolbar" ref={toolbarRef}>
        <div className="assistant-toolbar__group">
          <button
            type="button"
            className={`assistant-toolbar__item ${menuOpen ? 'assistant-toolbar__item--open' : ''}`}
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <IconFolder size={16} strokeWidth={1.75} />
            <span className="assistant-toolbar__label">{activeFolder?.name ?? 'Uncategorised'}</span>
          </button>
          {menuOpen && (
            <div className="assistant-menu" role="menu">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={activeFolderId === null}
                className={`assistant-menu__item ${activeFolderId === null ? 'assistant-menu__item--selected' : ''}`}
                onClick={() => handleSelectFolder(null)}
              >
                <IconFolders size={15} strokeWidth={1.75} className="assistant-menu__icon" />
                <span className="assistant-menu__text">Uncategorised</span>
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
                    <IconFolder size={15} strokeWidth={1.75} className="assistant-menu__icon" />
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
                  setMenuOpen(false);
                }}
              >
                <IconPlus size={14} strokeWidth={2} />
                <span>New folder</span>
              </button>
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
    </>
  );
};
