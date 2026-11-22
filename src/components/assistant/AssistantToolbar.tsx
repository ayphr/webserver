import { useRef, useState } from 'react';
import {
  IconArrowDown,
  IconClipboardList,
  IconFolder,
  IconFolderFilled,
  IconFolders,
  IconFoldersFilled,
  IconMenu2,
  IconMessageCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
} from '@tabler/icons-react';
import { sortAssistantFolders, type AssistantFolder, type AssistantMode } from '@common';
import { Tooltip } from '../common/Tooltip';
import { useRadio } from '../../context';
import { useDismiss } from '../../hooks/useDismiss';
import './AssistantToolbar.css';

export interface AssistantToolbarProps {
  folders: AssistantFolder[];
  activeFolderId: string | null;
  activeMode: AssistantMode;
  onSelectFolder: (folderId: string | null) => void;
  onSelectMode: (mode: AssistantMode) => void;
  onCreateFolder: (name: string) => void;
  showControls?: boolean;
  onToggleSidebar?: () => void;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
}

export const AssistantToolbar = ({
  folders,
  activeFolderId,
  activeMode,
  onSelectFolder,
  onSelectMode,
  onCreateFolder,
  showControls = true,
  onToggleSidebar,
  showJumpToLatest = false,
  onJumpToLatest,
}: AssistantToolbarProps) => {
  const { isPlaying: isRadioPlaying, toggle: toggleRadio } = useRadio();
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setMenuOpen(false);
    setCreatingFolder(false);
    setNewFolderName('');
  };

  useDismiss(toolbarRef, closeMenu, { enabled: menuOpen });

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  const handleSelectFolder = (folderId: string | null) => {
    onSelectFolder(folderId);
    closeMenu();
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    closeMenu();
  };

  return (
    <div className="assistant-toolbar" ref={toolbarRef}>
      {onToggleSidebar && (
        <button
          type="button"
          className="assistant-toolbar__mode-button assistant-toolbar__sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle chat list"
        >
          <IconMenu2 size={16} strokeWidth={1.75} />
        </button>
      )}
      <div className="assistant-toolbar__group" hidden={!showControls}>
        <button
          type="button"
          className={`assistant-toolbar__item ${menuOpen ? 'assistant-toolbar__item--open' : ''}`}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
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
              {activeFolderId === null ? (
                <IconFoldersFilled size={15} strokeWidth={1.75} className="assistant-menu__icon" />
              ) : (
                <IconFolders size={15} strokeWidth={1.75} className="assistant-menu__icon" />
              )}
              <span className="assistant-menu__text">Uncategorised</span>
            </button>
            {sortAssistantFolders(folders).map((folder) => {
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
                  {selected ? (
                    <IconFolderFilled size={15} strokeWidth={1.75} className="assistant-menu__icon" />
                  ) : (
                    <IconFolder size={15} strokeWidth={1.75} className="assistant-menu__icon" />
                  )}
                  <span className="assistant-menu__text">{folder.name}</span>
                </button>
              );
            })}
            {creatingFolder ? (
              <div className="assistant-menu__create">
                <IconPlus size={14} strokeWidth={2} className="assistant-menu__icon" />
                <input
                  autoFocus
                  className="assistant-menu__create-input"
                  aria-label="New folder name"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateFolder();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setCreatingFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  onBlur={() => {
                    setCreatingFolder(false);
                    setNewFolderName('');
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="assistant-menu__item assistant-menu__item--action"
                onClick={() => {
                  setNewFolderName('');
                  setCreatingFolder(true);
                }}
              >
                <IconPlus size={14} strokeWidth={2} />
                <span>New folder</span>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="assistant-toolbar__mode" role="group" aria-label="Assistant mode" hidden={!showControls}>
        <button
          type="button"
          className={`assistant-toolbar__mode-button ${activeMode === 'chat' ? 'assistant-toolbar__mode-button--active' : ''}`}
          aria-pressed={activeMode === 'chat'}
          onClick={() => onSelectMode('chat')}
        >
          <IconMessageCircle size={14} strokeWidth={1.75} />
          <span>Chat</span>
        </button>
        <button
          type="button"
          className={`assistant-toolbar__mode-button ${activeMode === 'task' ? 'assistant-toolbar__mode-button--active' : ''}`}
          aria-pressed={activeMode === 'task'}
          onClick={() => onSelectMode('task')}
        >
          <IconClipboardList size={14} strokeWidth={1.75} />
          <span>Task</span>
        </button>
      </div>
      {!showControls && (
        <div className="assistant-toolbar__context">
          <IconFolder size={13} strokeWidth={1.75} />
          <span>{activeFolder?.name ?? 'Uncategorised'}</span>
          {activeMode === 'task' ? (
            <IconClipboardList size={13} strokeWidth={1.75} />
          ) : (
            <IconMessageCircle size={13} strokeWidth={1.75} />
          )}
          <span>{activeMode === 'task' ? 'Task' : 'Chat'}</span>
        </div>
      )}
      {showJumpToLatest && onJumpToLatest && (
        <button
          type="button"
          className="assistant-toolbar__jump"
          onClick={onJumpToLatest}
        >
          <IconArrowDown size={14} strokeWidth={1.75} />
          <span>Jump to latest</span>
        </button>
      )}
      <div className="assistant-toolbar__radio">
        <Tooltip content={isRadioPlaying ? 'Pause radio' : 'Play radio'}>
          <button
            type="button"
            className={`assistant-toolbar__mode-button ${isRadioPlaying ? 'assistant-toolbar__mode-button--active' : ''}`}
            onClick={() => { void toggleRadio(); }}
            aria-label={isRadioPlaying ? 'Pause radio' : 'Play radio'}
            aria-pressed={isRadioPlaying}
          >
            {isRadioPlaying
              ? <IconPlayerPause size={16} strokeWidth={1.75} />
              : <IconPlayerPlay size={16} strokeWidth={1.75} />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
