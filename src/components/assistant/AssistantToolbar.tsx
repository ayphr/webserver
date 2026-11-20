import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  IconClipboardList,
  IconFolder,
  IconFolderFilled,
  IconFolders,
  IconFoldersFilled,
  IconMessageCircle,
  IconPlus,
} from '@tabler/icons-react';
import type { AssistantFolder, AssistantMode } from '@common';
import './AssistantToolbar.css';

export interface AssistantToolbarProps {
  folders: AssistantFolder[];
  activeFolderId: string | null;
  activeMode: AssistantMode;
  onSelectFolder: (folderId: string | null) => void;
  onSelectMode: (mode: AssistantMode) => void;
  onCreateFolder: (name: string) => void;
}

const MODES: AssistantMode[] = ['chat', 'task'];

export const AssistantToolbar = ({
  folders,
  activeFolderId,
  activeMode,
  onSelectFolder,
  onSelectMode,
  onCreateFolder,
}: AssistantToolbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modeButtonRefs = useRef<Partial<Record<AssistantMode, HTMLButtonElement | null>>>({});

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    setCreatingFolder(false);
    setNewFolderName('');
    if (restoreFocus) folderButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const target = creatingFolder
      ? menuRef.current?.querySelector<HTMLElement>('.assistant-menu__create-input')
      : (menuRef.current?.querySelector<HTMLElement>('.assistant-menu__item--selected') ??
        menuRef.current?.querySelector<HTMLElement>('.assistant-menu__item'));
    target?.focus();
  }, [menuOpen, creatingFolder]);

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);

  const getMenuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '.assistant-menu__item, .assistant-menu__create-input',
      ) ?? [],
    ).filter((item) => !item.hasAttribute('disabled'));

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    const items = getMenuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      nextIndex = current === -1 ? 0 : (current + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = current === -1 ? items.length - 1 : (current - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const handleSelectFolder = (folderId: string | null) => {
    onSelectFolder(folderId);
    closeMenu(true);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    closeMenu(true);
  };

  const handleModeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, mode: AssistantMode) => {
    const otherMode: AssistantMode = mode === 'chat' ? 'task' : 'chat';
    let next: AssistantMode | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = otherMode;
    } else if (event.key === 'Home') {
      next = MODES[0];
    } else if (event.key === 'End') {
      next = MODES[MODES.length - 1];
    }
    if (next === null) return;
    event.preventDefault();
    modeButtonRefs.current[next]?.focus();
    onSelectMode(next);
  };

  return (
    <div className="assistant-toolbar" ref={toolbarRef}>
      <div className="assistant-toolbar__group">
        <button
          type="button"
          ref={folderButtonRef}
          className={`assistant-toolbar__item ${menuOpen ? 'assistant-toolbar__item--open' : ''}`}
          onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
          aria-label={`Folder: ${activeFolder?.name ?? 'Uncategorised'}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <IconFolder size={16} strokeWidth={1.75} />
          <span className="assistant-toolbar__label">{activeFolder?.name ?? 'Uncategorised'}</span>
        </button>
        {menuOpen && (
          <div
            className="assistant-menu"
            role="menu"
            aria-label="Folders"
            ref={menuRef}
            onKeyDown={handleMenuKeyDown}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={activeFolderId === null}
              tabIndex={-1}
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
            {folders.map((folder) => {
              const selected = activeFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={-1}
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
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      handleCreateFolder();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      closeMenu(true);
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
                tabIndex={-1}
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
      <div className="assistant-toolbar__mode" role="group" aria-label="Assistant mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            ref={(element) => {
              modeButtonRefs.current[mode] = element;
            }}
            className={`assistant-toolbar__mode-button ${activeMode === mode ? 'assistant-toolbar__mode-button--active' : ''}`}
            aria-label={`${mode === 'chat' ? 'Chat' : 'Task'} mode`}
            aria-pressed={activeMode === mode}
            tabIndex={activeMode === mode ? 0 : -1}
            onClick={() => onSelectMode(mode)}
            onKeyDown={(event) => handleModeKeyDown(event, mode)}
          >
            {mode === 'chat' ? (
              <IconMessageCircle size={14} strokeWidth={1.75} />
            ) : (
              <IconClipboardList size={14} strokeWidth={1.75} />
            )}
            <span>{mode === 'chat' ? 'Chat' : 'Task'}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
