import { useRef, useState, type ReactNode } from 'react';
import {
  IconArrowDown,
  IconBell,
  IconBellFilled,
  IconBellMinus,
  IconBellMinusFilled,
  IconBellOff,
  IconClipboardList,
  IconClipboardListFilled,
  IconCloud,
  IconDeviceDesktop,
  IconFolder,
  IconFolderFilled,
  IconFolders,
  IconFoldersFilled,
  IconLayoutSidebar,
  IconLayoutSidebarFilled,
  IconMessageCircle,
  IconMessageCircleFilled,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconShieldExclamation,
  IconShieldMinus,
  IconShieldStar,
} from '@tabler/icons-react';
import {
  sortAssistantFolders,
  type AssistantFolder,
  type AssistantLocation,
  type AssistantMode,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
} from '@common';
import { Tooltip } from '../common/Tooltip';
import { useRadio } from '../../context';
import { useDismiss } from '../../hooks/useDismiss';
import './AssistantToolbar.css';

export interface AssistantToolbarProps {
  folders: AssistantFolder[];
  activeFolderId: string | null;
  activeMode: AssistantMode;
  taskLocation: AssistantLocation;
  permissionLevel: AssistantPermissionLevel;
  notificationLevel: AssistantNotificationLevel;
  onSelectFolder: (folderId: string | null) => void;
  onSelectMode: (mode: AssistantMode) => void;
  onSelectTaskLocation: (location: AssistantLocation) => void;
  onSelectPermissionLevel: (level: AssistantPermissionLevel) => void;
  onSelectNotificationLevel: (level: AssistantNotificationLevel) => void;
  onCreateFolder: (name: string) => void;
  showControls?: boolean;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
}

type MenuName = 'folder' | 'mode' | 'location' | 'permissions' | 'notifications';

type ToolbarOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  selectedIcon?: ReactNode;
};

type ToolbarSelectProps<T extends string> = {
  ariaLabel: string;
  options: readonly ToolbarOption<T>[];
  value: T;
  isOpen: boolean;
  hidden?: boolean;
  onToggle: () => void;
  onSelect: (value: T) => void;
};

const ToolbarSelect = <T extends string>({
  ariaLabel,
  options,
  value,
  isOpen,
  hidden = false,
  onToggle,
  onSelect,
}: ToolbarSelectProps<T>) => {
  const active = options.find((option) => option.value === value) ?? options[0];
  if (!active) return null;

  return (
    <div className="assistant-toolbar__group" hidden={hidden}>
      <button
        type="button"
        className={`assistant-toolbar__item ${isOpen ? 'assistant-toolbar__item--open' : ''}`}
        onClick={onToggle}
        aria-label={`${ariaLabel}: ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {active.icon}
        <span className="assistant-toolbar__label">{active.label}</span>
      </button>
      {isOpen && (
        <div className="assistant-menu" role="menu" aria-label={ariaLabel}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`assistant-menu__item ${selected ? 'assistant-menu__item--selected' : ''}`}
                onClick={() => onSelect(option.value)}
              >
                <span className="assistant-menu__icon">
                  {selected ? option.selectedIcon ?? option.icon : option.icon}
                </span>
                <span className="assistant-menu__text">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const MODE_OPTIONS: readonly ToolbarOption<AssistantMode>[] = [
  {
    value: 'chat',
    label: 'Chat',
    icon: <IconMessageCircle size={16} strokeWidth={1.75} />,
    selectedIcon: <IconMessageCircleFilled size={16} strokeWidth={1.75} />,
  },
  {
    value: 'task',
    label: 'Task',
    icon: <IconClipboardList size={16} strokeWidth={1.75} />,
    selectedIcon: <IconClipboardListFilled size={16} strokeWidth={1.75} />,
  },
];

const LOCATION_OPTIONS: readonly ToolbarOption<AssistantLocation>[] = [
  {
    value: 'local',
    label: 'Local',
    icon: <IconDeviceDesktop size={16} strokeWidth={1.75} />,
  },
  {
    value: 'cloud',
    label: 'Cloud',
    icon: <IconCloud size={16} strokeWidth={1.75} />,
  },
];

const PERMISSION_OPTIONS: readonly ToolbarOption<AssistantPermissionLevel>[] = [
  {
    value: 'always-ask',
    label: 'Always ask',
    icon: <IconShieldStar size={16} strokeWidth={1.75} />,
  },
  {
    value: 'sometimes-ask',
    label: 'Sometimes ask',
    icon: <IconShieldMinus size={16} strokeWidth={1.75} />,
  },
  {
    value: 'never-ask',
    label: 'Allow all',
    icon: <IconShieldExclamation size={16} strokeWidth={1.75} />,
  },
];

const NOTIFICATION_OPTIONS: readonly ToolbarOption<AssistantNotificationLevel>[] = [
  {
    value: 'always',
    label: 'Always notify',
    icon: <IconBell size={16} strokeWidth={1.75} />,
    selectedIcon: <IconBellFilled size={16} strokeWidth={1.75} />,
  },
  {
    value: 'sometimes',
    label: 'Sometimes notify',
    icon: <IconBellMinus size={16} strokeWidth={1.75} />,
    selectedIcon: <IconBellMinusFilled size={16} strokeWidth={1.75} />,
  },
  {
    value: 'never',
    label: 'Never notify',
    icon: <IconBellOff size={16} strokeWidth={1.75} />,
  },
];

export const AssistantToolbar = ({
  folders,
  activeFolderId,
  activeMode,
  taskLocation,
  permissionLevel,
  notificationLevel,
  onSelectFolder,
  onSelectMode,
  onSelectTaskLocation,
  onSelectPermissionLevel,
  onSelectNotificationLevel,
  onCreateFolder,
  showControls = true,
  onToggleSidebar,
  isSidebarOpen = false,
  showJumpToLatest = false,
  onJumpToLatest,
}: AssistantToolbarProps) => {
  const { isPlaying: isRadioPlaying, toggle: toggleRadio } = useRadio();
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setOpenMenu(null);
    setCreatingFolder(false);
    setNewFolderName('');
  };

  useDismiss(toolbarRef, closeMenu, { enabled: openMenu !== null });

  const activeFolder = folders.find((folder) => folder.id === activeFolderId);
  const isTask = activeMode === 'task';

  const toggleMenu = (menu: MenuName) => {
    if (openMenu === menu) {
      closeMenu();
      return;
    }
    setOpenMenu(menu);
    setCreatingFolder(false);
    setNewFolderName('');
  };

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
          className={`assistant-toolbar__mode-button assistant-toolbar__sidebar-toggle${isSidebarOpen ? ' assistant-toolbar__mode-button--active' : ''}`}
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Hide chat list' : 'Show chat list'}
          aria-expanded={isSidebarOpen}
          aria-controls="assistant-chat-list"
        >
          {isSidebarOpen
            ? <IconLayoutSidebarFilled size={16} strokeWidth={1.75} />
            : <IconLayoutSidebar size={16} strokeWidth={1.75} />}
        </button>
      )}
      <div className="assistant-toolbar__group" hidden={!showControls}>
        <button
          type="button"
          className={`assistant-toolbar__item ${openMenu === 'folder' ? 'assistant-toolbar__item--open' : ''}`}
          onClick={() => toggleMenu('folder')}
          aria-label={`Folder: ${activeFolder?.name ?? 'Uncategorised'}`}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'folder'}
        >
          <IconFolder size={16} strokeWidth={1.75} />
          <span className="assistant-toolbar__label">{activeFolder?.name ?? 'Uncategorised'}</span>
        </button>
        {openMenu === 'folder' && (
          <div className="assistant-menu" role="menu" aria-label="Folder">
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
      <ToolbarSelect
        ariaLabel="Assistant mode"
        options={MODE_OPTIONS}
        value={activeMode}
        isOpen={openMenu === 'mode'}
        hidden={!showControls}
        onToggle={() => toggleMenu('mode')}
        onSelect={(mode) => {
          onSelectMode(mode);
          closeMenu();
        }}
      />
      <ToolbarSelect
        ariaLabel="Task location"
        options={LOCATION_OPTIONS}
        value={taskLocation}
        isOpen={openMenu === 'location'}
        hidden={!showControls || !isTask}
        onToggle={() => toggleMenu('location')}
        onSelect={(location) => {
          onSelectTaskLocation(location);
          closeMenu();
        }}
      />
      <ToolbarSelect
        ariaLabel="Tool permissions"
        options={PERMISSION_OPTIONS}
        value={permissionLevel}
        isOpen={openMenu === 'permissions'}
        onToggle={() => toggleMenu('permissions')}
        onSelect={(level) => {
          onSelectPermissionLevel(level);
          closeMenu();
        }}
      />
      <ToolbarSelect
        ariaLabel="Cloud notifications"
        options={NOTIFICATION_OPTIONS}
        value={notificationLevel}
        isOpen={openMenu === 'notifications'}
        hidden={!isTask || taskLocation !== 'cloud'}
        onToggle={() => toggleMenu('notifications')}
        onSelect={(level) => {
          onSelectNotificationLevel(level);
          closeMenu();
        }}
      />
      {!showControls && (
        <div className="assistant-toolbar__context">
          <IconFolder size={13} strokeWidth={1.75} />
          <span>{activeFolder?.name ?? 'Uncategorised'}</span>
          {isTask ? (
            taskLocation === 'cloud'
              ? <IconCloud size={13} strokeWidth={1.75} />
              : <IconDeviceDesktop size={13} strokeWidth={1.75} />
          ) : (
            <IconMessageCircle size={13} strokeWidth={1.75} />
          )}
          <span>{isTask ? (taskLocation === 'cloud' ? 'Cloud task' : 'Local task') : 'Chat'}</span>
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
